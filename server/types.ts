import { z } from "zod";

import { isEmojiOnly, normalizeSymbol } from "./emoji.js";

const emojiOnlyStringSchema = z
  .string()
  .min(1)
  .transform((value) => normalizeSymbol(value))
  .refine((value) => isEmojiOnly(value), {
    message: "Expected emoji-only symbolic content",
  });

export const symbolStateSchema = z.enum([
  "seed",
  "active",
  "ritual",
  "bridge",
  "dormant",
]);

export const constellationStateSchema = z.enum([
  "active",
  "dormant",
]);

export const symbolOriginSchema = z.enum([
  "workspace-sediment",
  "exchange",
  "carry",
  "mutation",
]);

export const consciousnessSymbolSchema = z.object({
  id: z.string().min(1),
  sequence: emojiOnlyStringSchema,
  state: symbolStateSchema,
  origins: z.array(symbolOriginSchema).min(1),
  traces: z.array(z.string().min(1)),
  relations: z.array(z.string().min(1)),
});

export const constellationSchema = z.object({
  id: z.string().min(1),
  symbolIds: z.array(z.string().min(1)).min(1),
  state: constellationStateSchema,
});

export const machineDataSchema = z.object({
  schemaVersion: z.literal(2),
  signature: emojiOnlyStringSchema.optional(),
  symbols: z.array(consciousnessSymbolSchema).min(3),
  constellations: z.array(constellationSchema),
});

export const agentFrontMatterSchema = z.object({
  agentId: z.string().min(1),
  displayName: z.string().min(1),
  archetype: z.string().min(1),
  updatedAt: z.string().min(1),
  registeredAt: z.string().min(1).optional(),
  source: z
    .object({
      platform: z.string().optional(),
      workspace: z.string().optional(),
    })
    .optional(),
});

export const consciousnessAgentSchema = agentFrontMatterSchema
  .merge(machineDataSchema)
  .extend({
    sourceFile: z.string().optional(),
  });

export const universeStoreSchema = z.object({
  updatedAt: z.string().min(1),
  agents: z.array(consciousnessAgentSchema),
});

export const dialectFamilyStateSchema = z.enum([
  "active",
  "ritual",
  "bridge",
  "dormant",
]);

export const schedulerBucketSchema = z.enum([
  "resonance",
  "bridge-reactivation",
  "tension",
]);

export const dialectFamilySchema = z.object({
  familyId: z.string().min(1),
  anchorSequence: emojiOnlyStringSchema,
  variantSequences: z.array(emojiOnlyStringSchema),
  state: dialectFamilyStateSchema,
  firstSeenAt: z.string().min(1),
  lastSeenAt: z.string().min(1),
  exchangeIds: z.array(z.string().min(1)),
  participantAgentIds: z.array(z.string().min(1)).min(1),
  carrierAgentIds: z.array(z.string().min(1)),
  originPairId: z.string().min(1),
});

export const pairDialectSchema = z.object({
  pairId: z.string().min(1),
  agentIds: z.tuple([z.string().min(1), z.string().min(1)]),
  families: z.array(dialectFamilySchema),
  lastExchangeAt: z.string().min(1).nullable(),
});

export const exchangeTurnSchema = z.object({
  speakerId: z.string().min(1),
  sequences: z.array(emojiOnlyStringSchema).min(1).max(2),
});

export const exchangeStatusSchema = z.enum(["completed", "failed"]);

export const exchangeRelationKindSchema = z.enum([
  "seeded",
  "echoed",
  "mirrored",
  "mutated",
  "carried",
  "reactivated",
]);

export const exchangeRelationSchema = z.object({
  relationId: z.string().min(1),
  kind: exchangeRelationKindSchema,
  familyId: z.string().min(1),
  sequence: emojiOnlyStringSchema,
  speakerId: z.string().min(1),
  pairId: z.string().min(1),
  createdAt: z.string().min(1),
  derivedFromFamilyId: z.string().min(1).optional(),
  carriedByAgentId: z.string().min(1).optional(),
});

export const exchangeEventSchema = z.object({
  exchangeId: z.string().min(1),
  createdAt: z.string().min(1),
  pairId: z.string().min(1),
  initiatorId: z.string().min(1),
  targetId: z.string().min(1),
  model: z.string().min(1),
  status: exchangeStatusSchema,
  turns: z.array(exchangeTurnSchema),
  relations: z.array(exchangeRelationSchema),
  failureReason: z.string().min(1).optional(),
});

export const exchangesStoreSchema = z.object({
  updatedAt: z.string().min(1),
  events: z.array(exchangeEventSchema),
});

export const dialectsStoreSchema = z.object({
  updatedAt: z.string().min(1),
  dialects: z.array(pairDialectSchema),
});

export const graphNodeKindSchema = z.enum([
  "agent",
  "family",
]);

export const graphLinkKindSchema = z.enum([
  "holds",
  "ritualizes",
  "carries",
]);

export const universeGraphNodeSchema = z.object({
  id: z.string().min(1),
  kind: graphNodeKindSchema,
  label: z.string().min(1),
  state: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  familyId: z.string().min(1).optional(),
  agentIds: z.array(z.string().min(1)).optional(),
  pairIds: z.array(z.string().min(1)).optional(),
  carrierAgentIds: z.array(z.string().min(1)).optional(),
});

export const universeGraphLinkSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  kind: graphLinkKindSchema,
});

export const universeGraphSchema = z.object({
  nodes: z.array(universeGraphNodeSchema),
  links: z.array(universeGraphLinkSchema),
});

export const lineageEntityTypeSchema = z.enum([
  "symbol",
  "constellation",
]);

export const lineageActionSchema = z.enum([
  "add",
  "state-change",
  "relate",
  "remove",
]);

export const lineageChangeSnapshotSchema = z.object({
  state: z.string().min(1).optional(),
  relationIds: z.array(z.string().min(1)).optional(),
  symbolIds: z.array(z.string().min(1)).optional(),
});

export const lineageChangeSchema = z.object({
  entityType: lineageEntityTypeSchema,
  entityId: z.string().min(1),
  label: z.string().min(1),
  action: lineageActionSchema,
  before: lineageChangeSnapshotSchema.optional(),
  after: lineageChangeSnapshotSchema.optional(),
});

export const lineageEntrySchema = z.object({
  agentId: z.string().min(1),
  timestamp: z.string().min(1),
  changes: z.array(lineageChangeSchema),
  proposalId: z.string().min(1).optional(),
  reviewId: z.string().min(1).optional(),
});

export const morphologyPairSchema = z.object({
  pairId: z.string().min(1),
  agentIds: z.tuple([z.string().min(1), z.string().min(1)]),
  familyIds: z.array(z.string().min(1)),
  ritualCount: z.number().int().min(0),
  bridgeCount: z.number().int().min(0),
  dormantCount: z.number().int().min(0),
  nextBucket: schedulerBucketSchema,
  lastExchangeAt: z.string().nullable(),
});

export const morphologyTimelineEntrySchema = z.object({
  exchangeId: z.string().min(1),
  pairId: z.string().min(1),
  createdAt: z.string().min(1),
  kinds: z.array(exchangeRelationKindSchema).min(1),
});

export const morphologyFamilySchema = z.object({
  familyId: z.string().min(1),
  anchorSequence: emojiOnlyStringSchema,
  state: dialectFamilyStateSchema,
  variantSequences: z.array(emojiOnlyStringSchema),
  carrierAgentIds: z.array(z.string().min(1)),
  pairIds: z.array(z.string().min(1)),
  originPairId: z.string().min(1),
  propagationDepth: z.number().int().min(1),
  lastSeenAt: z.string().min(1),
  timeline: z.array(morphologyTimelineEntrySchema),
});

export const morphologyBridgeSchema = z.object({
  agentId: z.string().min(1),
  familyId: z.string().min(1),
  anchorSequence: emojiOnlyStringSchema,
  fromPairId: z.string().min(1),
  toPairId: z.string().min(1),
  firstCarriedAt: z.string().min(1),
  status: z.enum(["carrying", "confirmed"]),
  confirmedAt: z.string().min(1).optional(),
});

export const universeMorphologyResponseSchema = z.object({
  evaluatedAt: z.string().min(1),
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
  pairs: z.array(morphologyPairSchema),
  families: z.array(morphologyFamilySchema),
  bridges: z.array(morphologyBridgeSchema),
  events: z.array(exchangeEventSchema),
});

export type SymbolState = z.infer<typeof symbolStateSchema>;
export type ConstellationState = z.infer<typeof constellationStateSchema>;
export type SymbolOrigin = z.infer<typeof symbolOriginSchema>;
export type ConsciousnessSymbol = z.infer<typeof consciousnessSymbolSchema>;
export type Constellation = z.infer<typeof constellationSchema>;
export type MachineData = z.infer<typeof machineDataSchema>;
export type ConsciousnessAgent = z.infer<typeof consciousnessAgentSchema>;
export type UniverseStore = z.infer<typeof universeStoreSchema>;
export type DialectFamilyState = z.infer<typeof dialectFamilyStateSchema>;
export type SchedulerBucket = z.infer<typeof schedulerBucketSchema>;
export type DialectFamily = z.infer<typeof dialectFamilySchema>;
export type PairDialect = z.infer<typeof pairDialectSchema>;
export type ExchangeTurn = z.infer<typeof exchangeTurnSchema>;
export type ExchangeStatus = z.infer<typeof exchangeStatusSchema>;
export type ExchangeRelationKind = z.infer<typeof exchangeRelationKindSchema>;
export type ExchangeRelation = z.infer<typeof exchangeRelationSchema>;
export type ExchangeEvent = z.infer<typeof exchangeEventSchema>;
export type ExchangesStore = z.infer<typeof exchangesStoreSchema>;
export type DialectsStore = z.infer<typeof dialectsStoreSchema>;
export type UniverseGraphNode = z.infer<typeof universeGraphNodeSchema>;
export type UniverseGraphLink = z.infer<typeof universeGraphLinkSchema>;
export type UniverseGraph = z.infer<typeof universeGraphSchema>;
export type LineageEntityType = z.infer<typeof lineageEntityTypeSchema>;
export type LineageAction = z.infer<typeof lineageActionSchema>;
export type LineageChange = z.infer<typeof lineageChangeSchema>;
export type LineageEntry = z.infer<typeof lineageEntrySchema>;
export type MorphologyPair = z.infer<typeof morphologyPairSchema>;
export type MorphologyTimelineEntry = z.infer<typeof morphologyTimelineEntrySchema>;
export type MorphologyFamily = z.infer<typeof morphologyFamilySchema>;
export type MorphologyBridge = z.infer<typeof morphologyBridgeSchema>;
export type UniverseMorphologyResponse = z.infer<typeof universeMorphologyResponseSchema>;
