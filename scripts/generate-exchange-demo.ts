import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { ensureEmojiOnly } from "../server/emoji.js";
import { runExchangePulse, type ExchangeGenerator } from "../server/exchange-loop.js";
import {
  bootstrapVirtualAgentNetwork,
  createDeterministicExchangeGenerator,
} from "../server/demo-simulation.js";
import { loadDialectsStore } from "../server/store.js";
import type { ExchangeTurn, PairDialect } from "../server/types.js";

type FetchLike = typeof fetch;

type RemoteChoicePayload = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
      reasoning_content?: string;
    };
  }>;
};

type RemoteMessageContent = string | Array<{ text?: string }> | undefined;

function readOptionalEnv(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = readOptionalEnv(name);

  if (!value) {
    return fallback;
  }

  return value === "1" || value.toLowerCase() === "true";
}

export function readModels(): string[] {
  const raw = process.env.PANTHEON_SIM_MODELS ?? "xiaomimimo/mimo-v2-flash,moonshotai/kimi-k2.5,minimax/minimax-m2.5";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeContent(content: RemoteMessageContent, reasoningContent?: string): string {
  if (typeof reasoningContent === "string" && reasoningContent.trim()) {
    return reasoningContent;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("");
  }
  return content ?? "";
}

export function normalizeExchangeText(rawText: string): string {
  const cleaned = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/[0-9A-Za-z.,;:!?'"()\[\]{}<>/_\\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 4);

  if (cleaned.length !== 4) {
    throw new Error(`Expected 4 emoji lines after normalization, received ${cleaned.length}`);
  }

  return cleaned
    .map((line) =>
      line
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((sequence) => ensureEmojiOnly(sequence))
        .join(" "),
    )
    .join("\n");
}

function buildRemoteTurns(text: string, leftAgentId: string, rightAgentId: string): ExchangeTurn[] {
  return normalizeExchangeText(text)
    .split("\n")
    .map((line, index) => ({
      speakerId: index % 2 === 0 ? leftAgentId : rightAgentId,
      sequences: line.split(" "),
    }));
}

export async function requestRemoteExchangeCompletion(options: {
  prompt: string;
  leftAgentId: string;
  rightAgentId: string;
  endpoint?: string;
  token?: string;
  models?: string[];
  fetchImpl?: FetchLike;
}): Promise<{ model: string; turns: ExchangeTurn[] }> {
  const endpoint = options.endpoint ?? readRequiredEnv("PANTHEON_SIM_ENDPOINT");
  const token = options.token ?? readRequiredEnv("PANTHEON_SIM_BEARER_TOKEN");
  const models = options.models ?? readModels();
  const fetchImpl = options.fetchImpl ?? fetch;

  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.9,
          messages: [
            {
              role: "system",
              content:
                "Return exactly 4 lines. Each line must contain only 1 or 2 emoji sequences separated by a single space. Never output words, digits, punctuation, bullets, labels, or explanations.",
            },
            {
              role: "user",
              content: options.prompt,
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`${model} returned ${response.status}`);
      }

      const payload = (await response.json()) as RemoteChoicePayload;
      const message = payload.choices?.[0]?.message;
      const text = normalizeContent(message?.content, message?.reasoning_content);
      return {
        model,
        turns: buildRemoteTurns(text, options.leftAgentId, options.rightAgentId),
      };
    } catch (error) {
      const cause = error instanceof Error ? error.message : "Unknown remote simulator error";
      lastError = new Error(`${model} failed: ${cause}`);
    }
  }

  throw lastError ?? new Error("Remote simulator failed");
}

type CarryCandidate = {
  sequence: string;
  sourcePairId: string;
};

type PendingCarryFamily = {
  sequence: string;
  carrierAgentIds: string[];
};

function collectCarryCandidates(agentId: string, currentPairId: string, dialects: PairDialect[]): CarryCandidate[] {
  const values = dialects
    .filter((dialect) => dialect.pairId !== currentPairId && dialect.agentIds.includes(agentId))
    .flatMap((dialect) =>
      dialect.families
        .filter((family) => family.state === "ritual" || family.state === "bridge")
        .map((family) => ({
          sequence: family.anchorSequence,
          sourcePairId: dialect.pairId,
        })),
    );

  return values.filter((value, index, array) =>
    array.findIndex((candidate) => candidate.sequence === value.sequence && candidate.sourcePairId === value.sourcePairId) === index,
  );
}

function collectPendingCarryFamilies(currentPairId: string, dialect: PairDialect | null): PendingCarryFamily[] {
  return (dialect?.families ?? [])
    .filter((family) => family.originPairId !== currentPairId && family.state !== "bridge")
    .map((family) => ({
      sequence: family.anchorSequence,
      carrierAgentIds: [...family.carrierAgentIds],
    }));
}

function formatCarryCandidates(values: CarryCandidate[]): string {
  return values.length > 0 ? dedupeSequences(values.map((value) => value.sequence)).join(" ") : "none";
}

function formatPendingCarryFamilies(values: PendingCarryFamily[]): string {
  return values.length > 0 ? dedupeSequences(values.map((value) => value.sequence)).join(" ") : "none";
}

function dedupeSequences(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildPrompt(
  leftAgentId: string,
  rightAgentId: string,
  leftSignature: string,
  rightSignature: string,
  ritualFamilies: string[],
  leftCarryCandidates: CarryCandidate[],
  rightCarryCandidates: CarryCandidate[],
  pendingCarryFamilies: PendingCarryFamily[],
): string {
  const behaviorHint = pendingCarryFamilies.length > 0
    ? "If pending carried families exist, have the non-carrier agent reuse one of those pending carried families on a later line."
    : leftCarryCandidates.length > 0 || rightCarryCandidates.length > 0
      ? "If either agent has carry candidates, prefer introducing one carry candidate from another pair while keeping the exchange private and symbolic."
      : "Prefer symbolic drift, but keep at least one recognizable family surface available for later reuse.";

  return [
    "Generate a private emoji-only exchange between two agents.",
    "Return exactly 4 lines.",
    "Each line must contain 1 or 2 emoji sequences separated by a single space.",
    "Never include words, digits, punctuation, bullets, labels, or explanations.",
    `Left agent: ${leftAgentId} ${leftSignature}`,
    `Right agent: ${rightAgentId} ${rightSignature}`,
    `Ritual families: ${ritualFamilies.join(" ") || "none"}`,
    `Left carry candidates: ${formatCarryCandidates(leftCarryCandidates)}`,
    `Right carry candidates: ${formatCarryCandidates(rightCarryCandidates)}`,
    `Pending carried families in this pair: ${formatPendingCarryFamilies(pendingCarryFamilies)}`,
    behaviorHint,
  ].join("\n");
}

const exchangeGenerator: ExchangeGenerator = async (left, right, dialect) => {
  const currentPairId = [left.agentId, right.agentId].sort().join("::");
  const dialectStore = loadDialectsStore();
  const ritualFamilies = dialect?.families
    .filter((family) => family.state === "ritual" || family.state === "bridge")
    .map((family) => family.anchorSequence)
    .slice(0, 8) ?? [];
  const leftCarryCandidates = collectCarryCandidates(left.agentId, currentPairId, dialectStore.dialects).slice(0, 6);
  const rightCarryCandidates = collectCarryCandidates(right.agentId, currentPairId, dialectStore.dialects).slice(0, 6);
  const pendingCarryFamilies = collectPendingCarryFamilies(currentPairId, dialect).slice(0, 6);
  const prompt = buildPrompt(
    left.agentId,
    right.agentId,
    left.signature ?? left.displayName,
    right.signature ?? right.displayName,
    ritualFamilies,
    leftCarryCandidates,
    rightCarryCandidates,
    pendingCarryFamilies,
  );
  return requestRemoteExchangeCompletion({
    prompt,
    leftAgentId: left.agentId,
    rightAgentId: right.agentId,
  });
};

function resolveExchangeGenerator(): ExchangeGenerator {
  const protocol = readOptionalEnv("PANTHEON_SIM_PROTOCOL");
  const hasRemoteConfig = Boolean(readOptionalEnv("PANTHEON_SIM_ENDPOINT") && readOptionalEnv("PANTHEON_SIM_BEARER_TOKEN"));

  if (protocol === "fake" || !hasRemoteConfig) {
    return createDeterministicExchangeGenerator();
  }

  return exchangeGenerator;
}

function resetDemoFiles(): void {
  const targets = [
    path.join(process.cwd(), "data", "universe.json"),
    path.join(process.cwd(), "data", "exchanges.json"),
    path.join(process.cwd(), "data", "dialects.json"),
    path.join(process.cwd(), "data", "lineage.json"),
    path.join(process.cwd(), ".pantheon", "demo-workspaces"),
  ];

  for (const target of targets) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

export async function generateExchangeDemo(): Promise<void> {
  if (readBooleanEnv("PANTHEON_SIM_RESET_DATA", true)) {
    resetDemoFiles();
  }

  const workspaceRoot = path.join(process.cwd(), ".pantheon", "demo-workspaces");
  const bootstrapResults = await bootstrapVirtualAgentNetwork({
    workspaceRoot,
  });
  const pulseCount = Number.parseInt(process.env.PANTHEON_SIM_PULSE_COUNT ?? "3", 10);
  const spacingMinutes = Number.parseInt(process.env.PANTHEON_SIM_PULSE_SPACING_MINUTES ?? "11", 10);
  const minAffinity = Number.parseFloat(process.env.PANTHEON_SIM_MIN_AFFINITY ?? "0.15");
  const start = new Date();
  const resolvedExchangeGenerator = resolveExchangeGenerator();

  console.log(`Bootstrapped ${bootstrapResults.length} virtual agents into ${workspaceRoot}`);
  for (const result of bootstrapResults) {
    console.log(
      `- ${result.agentId}: ${result.symbolCountBefore} -> ${result.symbolCountAfter} symbols, ${result.sourceFileCount} source files`,
    );
  }

  for (let index = 0; index < pulseCount; index += 1) {
    const now = new Date(start.getTime() + index * spacingMinutes * 60 * 1000);
    const events = await runExchangePulse({
      now,
      exchangeGenerator: resolvedExchangeGenerator,
      minAffinity,
    });
    console.log(`Pulse ${index + 1}/${pulseCount}: ${events.length} exchanges`);
    if (index < pulseCount - 1) {
      await delay(250);
    }
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  generateExchangeDemo().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
