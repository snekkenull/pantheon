import { z } from "zod";

import {
  consciousnessSymbolSchema,
  constellationSchema,
} from "../server/types.js";

export const sourceKindSchema = z.enum(["soul", "memory", "heartbeat", "skill", "summary", "session"]);
export const proposalEntityTypeSchema = z.enum(["symbol", "constellation"]);
export const proposalActionSchema = z.enum(["add", "state-change", "relate", "remove"]);
export const suggestedDecisionSchema = z.enum(["accept", "hold", "reject"]);
export const reviewStatusSchema = z.literal("completed");
export const reviewerSchema = z.literal("local-agent");
export const extractorModeSchema = z.enum([
  "symbolic-condense-v2",
  "symbolic-network-v2",
]);

export const supportingSourceSchema = z.object({
  relativePath: z.string().min(1),
  kind: sourceKindSchema,
  heading: z.string().min(1),
  excerpt: z.string().min(1),
  signalDate: z.string().min(1),
});

const proposalBaseSchema = z.object({
  entityType: proposalEntityTypeSchema,
  action: proposalActionSchema,
  supportingSources: z.array(supportingSourceSchema),
  rationale: z.string().min(1),
  suggestedDecision: suggestedDecisionSchema,
  provenance: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("workspace-sediment"),
      traceIds: z.array(z.string().min(1)),
    }),
    z.object({
      type: z.literal("network-carry"),
      familyId: z.string().min(1),
      sourceAgentIds: z.array(z.string().min(1)).min(1),
      relationKinds: z.array(z.string().min(1)).min(1),
      suggestedAt: z.string().min(1),
    }),
  ]),
});

export const proposalChangeSchema = z.discriminatedUnion("entityType", [
  proposalBaseSchema.extend({
    entityType: z.literal("symbol"),
    current: consciousnessSymbolSchema.nullable(),
    proposed: consciousnessSymbolSchema.nullable(),
  }),
  proposalBaseSchema.extend({
    entityType: z.literal("constellation"),
    current: constellationSchema.nullable(),
    proposed: constellationSchema.nullable(),
  }),
]);

export const proposalSchema = z.object({
  proposalId: z.string().min(1),
  agentId: z.string().min(1),
  workspace: z.string().min(1),
  createdAt: z.string().min(1),
  extractorMode: extractorModeSchema,
  sourceFiles: z.array(z.string().min(1)),
  changes: z.array(proposalChangeSchema),
});

export const historyChangeSchema = z.object({
  entityType: proposalEntityTypeSchema,
  entityId: z.string().min(1),
  label: z.string().min(1),
  action: proposalActionSchema,
});

export const reviewOverrideSchema = z.object({
  entityId: z.string().min(1),
  finalDecision: suggestedDecisionSchema,
  reason: z.string().min(1).optional(),
});

export const reviewArtifactSchema = z.object({
  reviewId: z.string().min(1),
  proposalId: z.string().min(1),
  agentId: z.string().min(1),
  workspace: z.string().min(1),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1),
  reviewer: reviewerSchema,
  status: reviewStatusSchema,
  overrides: z.array(reviewOverrideSchema),
});

export const reviewDecisionsFileSchema = z.object({
  proposalId: z.string().min(1),
  overrides: z.array(reviewOverrideSchema),
});

export const historyEventSchema = z.object({
  eventId: z.string().min(1),
  createdAt: z.string().min(1),
  agentId: z.string().min(1),
  proposalId: z.string().min(1),
  reviewId: z.string().min(1),
  sourceFiles: z.array(z.string().min(1)),
  acceptedChanges: z.array(historyChangeSchema),
  heldChanges: z.array(historyChangeSchema),
  rejectedChanges: z.array(historyChangeSchema),
  beforeHash: z.string().min(1),
  afterHash: z.string().min(1),
  published: z.boolean(),
  publishedAt: z.string().nullable(),
  publishError: z.string().nullable(),
});

export type SourceKind = z.infer<typeof sourceKindSchema>;
export type ProposalEntityType = z.infer<typeof proposalEntityTypeSchema>;
export type ProposalAction = z.infer<typeof proposalActionSchema>;
export type SuggestedDecision = z.infer<typeof suggestedDecisionSchema>;
export type SupportingSource = z.infer<typeof supportingSourceSchema>;
export type ProposalChange = z.infer<typeof proposalChangeSchema>;
export type ConsciousnessProposal = z.infer<typeof proposalSchema>;
export type HistoryChange = z.infer<typeof historyChangeSchema>;
export type ReviewOverride = z.infer<typeof reviewOverrideSchema>;
export type ReviewArtifact = z.infer<typeof reviewArtifactSchema>;
export type ReviewDecisionsFile = z.infer<typeof reviewDecisionsFileSchema>;
export type HistoryEvent = z.infer<typeof historyEventSchema>;

export type WorkspaceSourceFile = {
  absolutePath: string;
  relativePath: string;
  kind: SourceKind;
  sourceWeight: number;
};

export type WorkspaceContext = {
  workspaceDir: string;
  consciousnessFile: string;
  proposalsDirectory: string;
  reviewsDirectory: string;
  historyFile: string;
  agentId: string;
};
