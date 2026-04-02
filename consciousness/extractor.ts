import fs from "node:fs";
import { randomUUID } from "node:crypto";

import matter from "gray-matter";

import {
  buildRelatedAgents,
  parseConsciousnessMarkdown,
} from "../server/consciousness.js";
import { ensureEmojiOnly } from "../server/emoji.js";
import { loadStore } from "../server/store.js";
import type {
  ConsciousnessAgent,
  ConsciousnessSymbol,
  Constellation,
} from "../server/types.js";
import {
  proposalSchema,
  type ConsciousnessProposal,
  type ProposalChange,
  type SupportingSource,
  type WorkspaceSourceFile,
} from "./types.js";
import { discoverWorkspaceSourceFiles, resolveWorkspace } from "./workspace.js";

function resolveSignalDate(rawDate: unknown, fallbackDate: Date): Date {
  if (rawDate instanceof Date) {
    return rawDate;
  }

  if (typeof rawDate === "string") {
    const parsed = new Date(rawDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return fallbackDate;
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function extractSupportingSources(sourceFile: WorkspaceSourceFile): SupportingSource[] {
  const fileContent = fs.readFileSync(sourceFile.absolutePath, "utf8");
  const parsed = matter(fileContent);
  const stats = fs.statSync(sourceFile.absolutePath);
  const signalDate = resolveSignalDate(parsed.data.date, stats.mtime).toISOString();
  const sources: SupportingSource[] = [];
  let currentHeading = "Signals";

  for (const line of parsed.content.split(/\r?\n/)) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
    if (!bulletMatch) {
      continue;
    }

    const excerpt = bulletMatch[1].trim();
    try {
      ensureEmojiOnly(excerpt);
      sources.push({
        relativePath: sourceFile.relativePath,
        kind: sourceFile.kind,
        heading: currentHeading,
        excerpt,
        signalDate,
      });
    } catch {
      continue;
    }
  }

  return sources;
}

function symbolTraceForSource(source: SupportingSource): string {
  return `${source.relativePath}#${source.heading}`;
}

function createSymbolProposalChanges(
  currentAgent: ConsciousnessAgent,
  supportingSources: SupportingSource[],
): { changes: ProposalChange[]; symbolIdBySequence: Map<string, string> } {
  const grouped = new Map<string, SupportingSource[]>();
  const symbolIdBySequence = new Map(currentAgent.symbols.map((symbol) => [symbol.sequence, symbol.id]));

  for (const source of supportingSources) {
    const bucket = grouped.get(source.excerpt) ?? [];
    bucket.push(source);
    grouped.set(source.excerpt, bucket);
  }

  const changes: ProposalChange[] = [];

  for (const [sequence, sources] of grouped) {
    const current = currentAgent.symbols.find((symbol) => symbol.sequence === sequence) ?? null;

    if (current) {
      if (current.state === "seed" || current.state === "dormant") {
        const proposed: ConsciousnessSymbol = {
          ...current,
          state: "active",
          traces: Array.from(new Set([...current.traces, ...sources.map(symbolTraceForSource)])),
        };
        changes.push({
          entityType: "symbol",
          action: "state-change",
          current,
          proposed,
          supportingSources: sources,
          rationale: "Workspace sediment reactivated an existing symbol.",
          suggestedDecision: "accept",
          provenance: {
            type: "workspace-sediment",
            traceIds: sources.map(symbolTraceForSource),
          },
        });
      }

      symbolIdBySequence.set(sequence, current.id);
      continue;
    }

    const nextId = randomUUID();
    symbolIdBySequence.set(sequence, nextId);
    changes.push({
      entityType: "symbol",
      action: "add",
      current: null,
      proposed: {
        id: nextId,
        sequence,
        state: "seed",
        origins: ["workspace-sediment"],
        traces: sources.map(symbolTraceForSource),
        relations: [],
      },
      supportingSources: sources,
      rationale: "New symbol condensed from repeated workspace sediment.",
      suggestedDecision: "accept",
      provenance: {
        type: "workspace-sediment",
        traceIds: sources.map(symbolTraceForSource),
      },
    });
  }

  return { changes, symbolIdBySequence };
}

function createConstellationProposalChanges(
  currentAgent: ConsciousnessAgent,
  supportingSources: SupportingSource[],
  symbolIdBySequence: Map<string, string>,
): ProposalChange[] {
  const grouped = new Map<string, Set<string>>();

  for (const source of supportingSources) {
    const symbolId = symbolIdBySequence.get(source.excerpt);
    if (!symbolId) {
      continue;
    }

    const key = `${source.relativePath}:${normalizeHeading(source.heading)}`;
    const bucket = grouped.get(key) ?? new Set<string>();
    bucket.add(symbolId);
    grouped.set(key, bucket);
  }

  const changes: ProposalChange[] = [];

  for (const [key, symbolIdsSet] of grouped) {
    const symbolIds = Array.from(symbolIdsSet);
    if (symbolIds.length < 2) {
      continue;
    }

    const existing = currentAgent.constellations.find((constellation) =>
      constellation.symbolIds.length === symbolIds.length &&
      constellation.symbolIds.every((symbolId) => symbolIds.includes(symbolId)),
    ) ?? null;

    const supporting = supportingSources.filter((source) => key === `${source.relativePath}:${normalizeHeading(source.heading)}`);

    if (existing) {
      if (existing.state === "dormant") {
        changes.push({
          entityType: "constellation",
          action: "state-change",
          current: existing,
          proposed: {
            ...existing,
            state: "active",
          },
          supportingSources: supporting,
          rationale: "Existing constellation reappeared in workspace sediment.",
          suggestedDecision: "accept",
          provenance: {
            type: "workspace-sediment",
            traceIds: supporting.map(symbolTraceForSource),
          },
        });
      }
      continue;
    }

    changes.push({
      entityType: "constellation",
      action: "add",
      current: null,
      proposed: {
        id: randomUUID(),
        symbolIds,
        state: "active",
      },
      supportingSources: supporting,
      rationale: "Symbols co-occurred under a shared workspace heading and formed a local constellation.",
      suggestedDecision: "accept",
      provenance: {
        type: "workspace-sediment",
        traceIds: supporting.map(symbolTraceForSource),
      },
    });
  }

  return changes;
}

export function extractConsciousnessProposal(options: {
  workspace: string;
  agentId?: string;
  now?: Date;
}): ConsciousnessProposal {
  const now = options.now ?? new Date();
  const workspace = resolveWorkspace(options.workspace, options.agentId);
  const currentAgent = parseConsciousnessMarkdown(
    fs.readFileSync(workspace.consciousnessFile, "utf8"),
    workspace.consciousnessFile,
  );
  const sourceFiles = discoverWorkspaceSourceFiles(workspace.workspaceDir);
  const supportingSources = sourceFiles.flatMap(extractSupportingSources);
  const { changes: symbolChanges, symbolIdBySequence } = createSymbolProposalChanges(currentAgent, supportingSources);
  const constellationChanges = createConstellationProposalChanges(currentAgent, supportingSources, symbolIdBySequence);
  const createdAt = now.toISOString();
  const proposalId = `${createdAt.replace(/[-:.]/g, "").replace("Z", "")}-${currentAgent.agentId}`;

  return proposalSchema.parse({
    proposalId,
    agentId: currentAgent.agentId,
    workspace: workspace.workspaceDir,
    createdAt,
    extractorMode: "symbolic-condense-v2",
    sourceFiles: sourceFiles.map((sourceFile) => sourceFile.relativePath),
    changes: [...symbolChanges, ...constellationChanges],
  });
}

export function suggestConsciousnessProposal(options: {
  workspace: string;
  agentId?: string;
  now?: Date;
}): ConsciousnessProposal {
  const now = options.now ?? new Date();
  const workspace = resolveWorkspace(options.workspace, options.agentId);
  const currentAgent = parseConsciousnessMarkdown(
    fs.readFileSync(workspace.consciousnessFile, "utf8"),
    workspace.consciousnessFile,
  );
  const store = loadStore();
  const related = buildRelatedAgents(currentAgent.agentId, [
    ...store.agents.filter((agent) => agent.agentId !== currentAgent.agentId),
    currentAgent,
  ]);
  const currentSequences = new Set(currentAgent.symbols.map((symbol) => symbol.sequence));
  const createdAt = now.toISOString();
  const changes: ProposalChange[] = related.suggestions
    .filter((suggestion) => !currentSequences.has(suggestion.sequence))
    .slice(0, 4)
    .map((suggestion) => ({
      entityType: "symbol" as const,
      action: "add" as const,
      current: null,
      proposed: {
        id: randomUUID(),
        sequence: suggestion.sequence,
        state: "seed" as const,
        origins: ["carry" as const],
        traces: [`network:${suggestion.symbolId}:${createdAt}`],
        relations: [],
      },
      supportingSources: [],
      rationale: `Related agents already circulate this symbol: ${suggestion.seenInAgents.join(", ")}.`,
      suggestedDecision: "accept" as const,
      provenance: {
        type: "network-carry" as const,
        familyId: suggestion.symbolId,
        sourceAgentIds: related.neighbors.map((neighbor) => neighbor.agentId).slice(0, 3),
        relationKinds: ["carried"],
        suggestedAt: createdAt,
      },
    }));
  const proposalId = `${createdAt.replace(/[-:.]/g, "").replace("Z", "")}-${currentAgent.agentId}-suggest`;

  return proposalSchema.parse({
    proposalId,
    agentId: currentAgent.agentId,
    workspace: workspace.workspaceDir,
    createdAt,
    extractorMode: "symbolic-network-v2",
    sourceFiles: [],
    changes,
  });
}
