import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import matter from "gray-matter";

import {
  buildMachineData,
  parseConsciousnessMarkdown,
  replaceMachineDataBlock,
} from "../server/consciousness.js";
import { appendLineage } from "../server/store.js";
import type {
  ConsciousnessAgent,
  LineageChange,
} from "../server/types.js";
import { extractConsciousnessProposal, suggestConsciousnessProposal } from "./extractor.js";
import {
  historyEventSchema,
  proposalSchema,
  reviewArtifactSchema,
  reviewDecisionsFileSchema,
  type ConsciousnessProposal,
  type HistoryChange,
  type HistoryEvent,
  type ProposalChange,
  type ReviewArtifact,
  type ReviewDecisionsFile,
  type ReviewOverride,
  type SuggestedDecision,
} from "./types.js";
import { resolveWorkspace } from "./workspace.js";

const DEFAULT_API_BASE_URL = process.env.PANTHEON_API_URL ?? "http://localhost:8787";

type FetchLike = typeof fetch;

type ResolvedDecision = {
  change: ProposalChange;
  finalDecision: SuggestedDecision;
  override: ReviewOverride | null;
};

function ensureDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
}

function hashContent(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rewriteConsciousnessMarkdown(
  rawMarkdown: string,
  agent: ConsciousnessAgent,
  updatedAt: string,
): string {
  const parsed = matter(rawMarkdown);
  const withFrontMatter = matter.stringify(parsed.content, {
    ...parsed.data,
    updatedAt,
  });

  return replaceMachineDataBlock(
    withFrontMatter,
    buildMachineData({
      ...agent,
      updatedAt,
    }),
  );
}

function getProposalPath(proposalsDirectory: string, proposalId: string): string {
  return path.join(proposalsDirectory, `${proposalId}.json`);
}

function getReviewPath(reviewsDirectory: string, proposalId: string): string {
  return path.join(reviewsDirectory, `${proposalId}.json`);
}

function changeEntityId(change: ProposalChange): string {
  const entity = change.proposed ?? change.current;
  if (!entity) {
    throw new Error("Proposal change is missing entity data");
  }
  return entity.id;
}

function changeLabel(change: ProposalChange): string {
  if (change.entityType === "symbol") {
    const entity = change.proposed ?? change.current;
    if (!entity) {
      throw new Error("Proposal change is missing entity data");
    }
    return entity.sequence;
  }

  const entity = change.proposed ?? change.current;
  if (!entity) {
    throw new Error("Proposal change is missing entity data");
  }
  return entity.symbolIds.join(" ");
}

function toHistoryChange(change: ProposalChange): HistoryChange {
  return {
    entityType: change.entityType,
    entityId: changeEntityId(change),
    label: changeLabel(change),
    action: change.action,
  };
}

function toLineageChange(change: ProposalChange): LineageChange {
  if (change.entityType === "symbol") {
    return {
      entityType: "symbol",
      entityId: changeEntityId(change),
      label: changeLabel(change),
      action: change.action,
      before: change.current
        ? {
            state: change.current.state,
            relationIds: change.current.relations,
          }
        : undefined,
      after: change.proposed
        ? {
            state: change.proposed.state,
            relationIds: change.proposed.relations,
          }
        : undefined,
    };
  }

  return {
    entityType: "constellation",
    entityId: changeEntityId(change),
    label: changeLabel(change),
    action: change.action,
    before: change.current
      ? {
          state: change.current.state,
          symbolIds: change.current.symbolIds,
        }
      : undefined,
    after: change.proposed
      ? {
          state: change.proposed.state,
          symbolIds: change.proposed.symbolIds,
        }
      : undefined,
  };
}

async function publishConsciousness(options: {
  agent: ConsciousnessAgent;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}) {
  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(
    new URL(
      `/api/agents/${encodeURIComponent(options.agent.agentId)}/consciousness`,
      apiBaseUrl,
    ),
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(options.agent),
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Publish failed with ${response.status}${body ? `: ${body}` : ""}`);
  }

  return response.json();
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function buildReviewId(proposalId: string): string {
  return `${proposalId}-review`;
}

function buildAutonomyId(proposalId: string): string {
  return `${proposalId}-autonomous`;
}

function ensureUniqueOverrides(overrides: ReviewOverride[]): void {
  const seen = new Set<string>();

  for (const override of overrides) {
    if (seen.has(override.entityId)) {
      throw new Error(`Duplicate override for entityId ${override.entityId}`);
    }

    seen.add(override.entityId);
  }
}

function resolveDecisions(
  proposal: ConsciousnessProposal,
  review: ReviewArtifact | null,
): ResolvedDecision[] {
  const overrideMap = new Map<string, ReviewOverride>();

  for (const override of review?.overrides ?? []) {
    overrideMap.set(override.entityId, override);
  }

  return proposal.changes.map((change) => {
    const entityId = changeEntityId(change);
    const override = overrideMap.get(entityId) ?? null;
    return {
      change,
      finalDecision: override?.finalDecision ?? change.suggestedDecision,
      override,
    };
  });
}

function summarizeDecisions(decisions: ResolvedDecision[]): Record<SuggestedDecision, number> {
  return decisions.reduce(
    (summary, decision) => {
      summary[decision.finalDecision] += 1;
      return summary;
    },
    {
      accept: 0,
      hold: 0,
      reject: 0,
    },
  );
}

function validateReviewOverrides(
  proposal: ConsciousnessProposal,
  decisionsFile: ReviewDecisionsFile,
): void {
  ensureUniqueOverrides(decisionsFile.overrides);
  const proposalEntityIds = new Set(proposal.changes.map(changeEntityId));

  for (const override of decisionsFile.overrides) {
    if (!proposalEntityIds.has(override.entityId)) {
      throw new Error(`Override entityId ${override.entityId} does not exist in proposal ${proposal.proposalId}`);
    }
  }
}

export function resolveProposalPath(
  workspace: string,
  proposalPath: string | undefined,
  agentId?: string,
): string {
  if (proposalPath) {
    return path.resolve(process.cwd(), proposalPath);
  }

  const context = resolveWorkspace(workspace, agentId);
  const files = fs.existsSync(context.proposalsDirectory)
    ? fs.readdirSync(context.proposalsDirectory)
      .filter((entry) => entry.endsWith(".json"))
      .sort()
    : [];

  if (files.length === 0) {
    throw new Error(`No proposal artifacts found for ${agentId}`);
  }

  return path.join(context.proposalsDirectory, files[files.length - 1]);
}

export function resolveReviewPath(options: {
  workspace: string;
  proposalId: string;
  reviewPath?: string;
  agentId?: string;
  required: boolean;
}): string | null {
  if (options.reviewPath) {
    return path.resolve(process.cwd(), options.reviewPath);
  }

  const context = resolveWorkspace(options.workspace, options.agentId);
  const reviewPath = getReviewPath(context.reviewsDirectory, options.proposalId);
  if (fs.existsSync(reviewPath)) {
    return reviewPath;
  }

  if (options.required) {
    return null;
  }

  return null;
}

export function writeProposalFile(
  proposal: ConsciousnessProposal,
  proposalsDirectory: string,
): string {
  ensureDirectory(proposalsDirectory);
  const proposalPath = getProposalPath(proposalsDirectory, proposal.proposalId);
  fs.writeFileSync(proposalPath, JSON.stringify(proposalSchema.parse(proposal), null, 2));
  return proposalPath;
}

export function readProposalFile(proposalPath: string): ConsciousnessProposal {
  return proposalSchema.parse(readJsonFile<unknown>(proposalPath));
}

export function readReviewFile(reviewPath: string): ReviewArtifact {
  return reviewArtifactSchema.parse(readJsonFile<unknown>(reviewPath));
}

export function formatProposalReview(
  proposal: ConsciousnessProposal,
  review: ReviewArtifact | null,
): string {
  const resolved = resolveDecisions(proposal, review);
  if (resolved.length === 0) {
    return "No pending changes.";
  }

  return resolved.map((decision) => {
    const label = decision.change.entityType === "symbol"
      ? (decision.change.proposed ?? decision.change.current)?.sequence ?? decision.change.action
      : (decision.change.proposed ?? decision.change.current)?.symbolIds.join(" ") ?? decision.change.action;
    return `${decision.change.entityType}:${label} -> ${decision.finalDecision}`;
  }).join("\n");
}

function applyAcceptedChanges(currentAgent: ConsciousnessAgent, changes: ProposalChange[]): ConsciousnessAgent {
  const symbols = new Map(currentAgent.symbols.map((symbol) => [symbol.id, symbol]));
  const constellations = new Map(currentAgent.constellations.map((constellation) => [constellation.id, constellation]));

  for (const change of changes) {
    const entityId = changeEntityId(change);

    if (change.entityType === "symbol") {
      if (change.action === "remove") {
        symbols.delete(entityId);
        continue;
      }

      if (change.proposed) {
        symbols.set(entityId, change.proposed);
      }
      continue;
    }

    if (change.action === "remove") {
      constellations.delete(entityId);
      continue;
    }

    if (change.proposed) {
      constellations.set(entityId, change.proposed);
    }
  }

  return {
    ...currentAgent,
    symbols: Array.from(symbols.values()).sort((left, right) => left.sequence.localeCompare(right.sequence)),
    constellations: Array.from(constellations.values()).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function writeHistoryEvent(historyFile: string, event: HistoryEvent): void {
  ensureDirectory(path.dirname(historyFile));
  fs.appendFileSync(historyFile, `${JSON.stringify(historyEventSchema.parse(event))}\n`);
}

export function reviewProposal(options: {
  workspace: string;
  proposalPath?: string;
  decisionsPath?: string;
  agentId?: string;
  now?: Date;
}): {
  proposal: ConsciousnessProposal;
  proposalPath: string;
  review: ReviewArtifact;
  reviewPath: string;
  decisionSummary: Record<SuggestedDecision, number>;
} {
  const now = options.now ?? new Date();
  const context = resolveWorkspace(options.workspace, options.agentId);
  const resolvedProposalPath = resolveProposalPath(options.workspace, options.proposalPath, context.agentId);
  const proposal = readProposalFile(resolvedProposalPath);

  if (proposal.agentId !== context.agentId) {
    throw new Error(`Proposal agentId ${proposal.agentId} does not match workspace agentId ${context.agentId}`);
  }

  const decisionsFile = options.decisionsPath
    ? reviewDecisionsFileSchema.parse(readJsonFile<unknown>(path.resolve(process.cwd(), options.decisionsPath)))
    : { proposalId: proposal.proposalId, overrides: [] };

  if (decisionsFile.proposalId !== proposal.proposalId) {
    throw new Error(`Review decisions proposalId ${decisionsFile.proposalId} does not match proposal ${proposal.proposalId}`);
  }

  validateReviewOverrides(proposal, decisionsFile);

  const review = reviewArtifactSchema.parse({
    reviewId: buildReviewId(proposal.proposalId),
    proposalId: proposal.proposalId,
    agentId: proposal.agentId,
    workspace: proposal.workspace,
    createdAt: now.toISOString(),
    completedAt: now.toISOString(),
    reviewer: "local-agent",
    status: "completed",
    overrides: decisionsFile.overrides,
  });
  const reviewPath = getReviewPath(context.reviewsDirectory, proposal.proposalId);
  ensureDirectory(context.reviewsDirectory);
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2));

  return {
    proposal,
    proposalPath: resolvedProposalPath,
    review,
    reviewPath,
    decisionSummary: summarizeDecisions(resolveDecisions(proposal, review)),
  };
}

export async function applyAutonomousProposal(options: {
  workspace: string;
  proposalPath?: string;
  apiBaseUrl?: string;
  agentId?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<{
  proposal: ConsciousnessProposal;
  proposalPath: string;
  historyPath: string;
  published: boolean;
  publishedAt: string | null;
  noOp: boolean;
}> {
  const context = resolveWorkspace(options.workspace, options.agentId);
  const resolvedProposalPath = resolveProposalPath(options.workspace, options.proposalPath, context.agentId);
  const proposal = readProposalFile(resolvedProposalPath);

  if (proposal.agentId !== context.agentId) {
    throw new Error(`Proposal agentId ${proposal.agentId} does not match workspace agentId ${context.agentId}`);
  }

  const rawMarkdown = fs.readFileSync(context.consciousnessFile, "utf8");
  const currentAgent = parseConsciousnessMarkdown(rawMarkdown, context.consciousnessFile);
  const resolvedDecisions = resolveDecisions(proposal, null);
  const acceptedDecisions = resolvedDecisions.filter((decision) => decision.finalDecision === "accept");
  const heldDecisions = resolvedDecisions.filter((decision) => decision.finalDecision === "hold");
  const rejectedDecisions = resolvedDecisions.filter((decision) => decision.finalDecision === "reject");
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const nextAgent = applyAcceptedChanges(currentAgent, acceptedDecisions.map((decision) => decision.change));
  const nextMarkdown = acceptedDecisions.length > 0
    ? rewriteConsciousnessMarkdown(rawMarkdown, { ...nextAgent, updatedAt: nowIso }, nowIso)
    : rawMarkdown;
  const hasMutation = nextMarkdown !== rawMarkdown;

  if (hasMutation) {
    fs.writeFileSync(context.consciousnessFile, nextMarkdown);
  }

  if (acceptedDecisions.length > 0) {
    appendLineage({
      agentId: proposal.agentId,
      timestamp: nowIso,
      proposalId: proposal.proposalId,
      reviewId: buildAutonomyId(proposal.proposalId),
      changes: acceptedDecisions.map((decision) => toLineageChange(decision.change)),
    });
  }

  let published = false;
  let publishedAt: string | null = null;
  let publishError: string | null = null;

  if (hasMutation) {
    try {
      await publishConsciousness({
        agent: { ...nextAgent, updatedAt: nowIso },
        apiBaseUrl: options.apiBaseUrl,
        fetchImpl: options.fetchImpl,
      });
      published = true;
      publishedAt = nowIso;
    } catch (error) {
      publishError = error instanceof Error ? error.message : "Unknown publish error";
    }
  }

  writeHistoryEvent(context.historyFile, {
    eventId: `${proposal.proposalId}-${nowIso.replace(/[-:.]/g, "")}`,
    createdAt: nowIso,
    agentId: proposal.agentId,
    proposalId: proposal.proposalId,
    reviewId: buildAutonomyId(proposal.proposalId),
    sourceFiles: proposal.sourceFiles,
    acceptedChanges: acceptedDecisions.map((decision) => toHistoryChange(decision.change)),
    heldChanges: heldDecisions.map((decision) => toHistoryChange(decision.change)),
    rejectedChanges: rejectedDecisions.map((decision) => toHistoryChange(decision.change)),
    beforeHash: hashContent(rawMarkdown),
    afterHash: hashContent(nextMarkdown),
    published,
    publishedAt,
    publishError,
  });

  if (publishError) {
    throw new Error(`Applied local autonomous changes, but publish failed: ${publishError}`);
  }

  return {
    proposal,
    proposalPath: resolvedProposalPath,
    historyPath: context.historyFile,
    published,
    publishedAt,
    noOp: !hasMutation,
  };
}

export async function evolveConsciousness(options: {
  workspace: string;
  agentId?: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<{
  proposal: ConsciousnessProposal;
  proposalPath: string;
  historyPath: string;
  published: boolean;
  publishedAt: string | null;
  noOp: boolean;
}> {
  const now = options.now ?? new Date();
  const context = resolveWorkspace(options.workspace, options.agentId);
  const extractProposal = extractConsciousnessProposal({
    workspace: options.workspace,
    agentId: options.agentId,
    now,
  });
  const networkProposal = suggestConsciousnessProposal({
    workspace: options.workspace,
    agentId: options.agentId,
    now,
  });
  const mergedProposal = proposalSchema.parse({
    ...extractProposal,
    extractorMode: "symbolic-network-v2",
    changes: [...extractProposal.changes, ...networkProposal.changes],
  });
  const proposalPath = writeProposalFile(mergedProposal, context.proposalsDirectory);

  return applyAutonomousProposal({
    workspace: options.workspace,
    proposalPath,
    apiBaseUrl: options.apiBaseUrl,
    agentId: options.agentId,
    fetchImpl: options.fetchImpl,
    now,
  });
}

export async function applyProposal(options: {
  workspace: string;
  proposalPath?: string;
  reviewPath?: string;
  apiBaseUrl?: string;
  agentId?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<{
  proposal: ConsciousnessProposal;
  proposalPath: string;
  review: ReviewArtifact;
  reviewPath: string;
  historyPath: string;
  published: boolean;
  publishedAt: string | null;
  noOp: boolean;
}> {
  const context = resolveWorkspace(options.workspace, options.agentId);
  const resolvedProposalPath = resolveProposalPath(options.workspace, options.proposalPath, context.agentId);
  const proposal = readProposalFile(resolvedProposalPath);
  const resolvedReviewPath = resolveReviewPath({
    workspace: options.workspace,
    proposalId: proposal.proposalId,
    reviewPath: options.reviewPath,
    agentId: context.agentId,
    required: true,
  });

  if (!resolvedReviewPath) {
    throw new Error(`No completed review artifact found for proposal ${proposal.proposalId}; run 'pnpm consciousness review' first`);
  }

  const review = readReviewFile(resolvedReviewPath);
  const rawMarkdown = fs.readFileSync(context.consciousnessFile, "utf8");
  const currentAgent = parseConsciousnessMarkdown(rawMarkdown, context.consciousnessFile);
  const resolvedDecisions = resolveDecisions(proposal, review);
  const acceptedDecisions = resolvedDecisions.filter((decision) => decision.finalDecision === "accept");
  const heldDecisions = resolvedDecisions.filter((decision) => decision.finalDecision === "hold");
  const rejectedDecisions = resolvedDecisions.filter((decision) => decision.finalDecision === "reject");
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const nextAgent = applyAcceptedChanges(currentAgent, acceptedDecisions.map((decision) => decision.change));
  const nextMarkdown = acceptedDecisions.length > 0
    ? rewriteConsciousnessMarkdown(rawMarkdown, { ...nextAgent, updatedAt: nowIso }, nowIso)
    : rawMarkdown;
  const hasMutation = nextMarkdown !== rawMarkdown;

  if (hasMutation) {
    fs.writeFileSync(context.consciousnessFile, nextMarkdown);
  }

  if (acceptedDecisions.length > 0) {
    appendLineage({
      agentId: proposal.agentId,
      timestamp: nowIso,
      proposalId: proposal.proposalId,
      reviewId: review.reviewId,
      changes: acceptedDecisions.map((decision) => toLineageChange(decision.change)),
    });
  }

  let published = false;
  let publishedAt: string | null = null;
  let publishError: string | null = null;

  if (hasMutation) {
    try {
      await publishConsciousness({
        agent: { ...nextAgent, updatedAt: nowIso },
        apiBaseUrl: options.apiBaseUrl,
        fetchImpl: options.fetchImpl,
      });
      published = true;
      publishedAt = nowIso;
    } catch (error) {
      publishError = error instanceof Error ? error.message : "Unknown publish error";
    }
  }

  writeHistoryEvent(context.historyFile, {
    eventId: `${proposal.proposalId}-${nowIso.replace(/[-:.]/g, "")}`,
    createdAt: nowIso,
    agentId: proposal.agentId,
    proposalId: proposal.proposalId,
    reviewId: review.reviewId,
    sourceFiles: proposal.sourceFiles,
    acceptedChanges: acceptedDecisions.map((decision) => toHistoryChange(decision.change)),
    heldChanges: heldDecisions.map((decision) => toHistoryChange(decision.change)),
    rejectedChanges: rejectedDecisions.map((decision) => toHistoryChange(decision.change)),
    beforeHash: hashContent(rawMarkdown),
    afterHash: hashContent(nextMarkdown),
    published,
    publishedAt,
    publishError,
  });

  if (publishError) {
    throw new Error(`Applied local consciousness changes, but publish failed: ${publishError}`);
  }

  return {
    proposal,
    proposalPath: resolvedProposalPath,
    review,
    reviewPath: resolvedReviewPath,
    historyPath: context.historyFile,
    published,
    publishedAt,
    noOp: !hasMutation,
  };
}
