import {
  type DialectsStore,
  type ExchangeEvent,
  type ExchangeRelationKind,
  type UniverseMorphologyResponse,
  universeMorphologyResponseSchema,
} from "./types.js";

const DEFAULT_WINDOW_HOURS = 24 * 7;

function classifyNextBucket(dialect: DialectsStore["dialects"][number]): "resonance" | "bridge-reactivation" | "tension" {
  if (dialect.families.some((family) => family.state === "active" || family.state === "ritual" || family.state === "bridge")) {
    return "resonance";
  }

  if (
    dialect.families.some(
      (family) =>
        family.state === "dormant" ||
        family.originPairId !== dialect.pairId ||
        family.carrierAgentIds.length > 0,
    )
  ) {
    return "bridge-reactivation";
  }

  return "tension";
}

function sortedKinds(kinds: Set<ExchangeRelationKind>): ExchangeRelationKind[] {
  return Array.from(kinds.values()).sort();
}

export function buildUniverseMorphology(options: {
  dialectStore: DialectsStore;
  events: ExchangeEvent[];
  now?: Date;
  windowHours?: number;
}): UniverseMorphologyResponse {
  const now = options.now ?? new Date();
  const windowHours = options.windowHours ?? DEFAULT_WINDOW_HOURS;
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const recentEvents = options.events
    .filter((event) => new Date(event.createdAt).getTime() >= windowStart.getTime())
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const familyMap = new Map<string, UniverseMorphologyResponse["families"][number]>();
  const bridgeMap = new Map<string, UniverseMorphologyResponse["bridges"][number]>();
  const familyTimelineMap = new Map<string, Map<string, UniverseMorphologyResponse["families"][number]["timeline"][number]>>();

  for (const event of recentEvents) {
    for (const relation of event.relations) {
      const eventTimeline = familyTimelineMap.get(relation.familyId) ?? new Map();
      const entryId = `${event.exchangeId}:${relation.familyId}`;
      const existing = eventTimeline.get(entryId);

      if (existing) {
        existing.kinds = sortedKinds(new Set([...existing.kinds, relation.kind]));
      } else {
        eventTimeline.set(entryId, {
          exchangeId: event.exchangeId,
          pairId: event.pairId,
          createdAt: event.createdAt,
          kinds: [relation.kind],
        });
      }

      familyTimelineMap.set(relation.familyId, eventTimeline);
    }
  }

  const pairs = options.dialectStore.dialects.map((dialect) => ({
    pairId: dialect.pairId,
    agentIds: dialect.agentIds,
    familyIds: dialect.families.map((family) => family.familyId),
    ritualCount: dialect.families.filter((family) => family.state === "ritual" || family.state === "bridge").length,
    bridgeCount: dialect.families.filter((family) => family.state === "bridge").length,
    dormantCount: dialect.families.filter((family) => family.state === "dormant").length,
    nextBucket: classifyNextBucket(dialect),
    lastExchangeAt: dialect.lastExchangeAt,
  })).sort((left, right) => (right.lastExchangeAt ?? "").localeCompare(left.lastExchangeAt ?? ""));

  for (const dialect of options.dialectStore.dialects) {
    for (const family of dialect.families) {
      const timeline = Array.from(familyTimelineMap.get(family.familyId)?.values() ?? []).sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      );
      const existing = familyMap.get(family.familyId);

      if (existing) {
        existing.variantSequences = Array.from(new Set([...existing.variantSequences, ...family.variantSequences])).sort();
        existing.carrierAgentIds = Array.from(new Set([...existing.carrierAgentIds, ...family.carrierAgentIds])).sort();
        existing.pairIds = Array.from(new Set([...existing.pairIds, dialect.pairId])).sort();
        existing.propagationDepth = existing.pairIds.length;
        existing.timeline = [...existing.timeline, ...timeline].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        if (existing.lastSeenAt < family.lastSeenAt) {
          existing.lastSeenAt = family.lastSeenAt;
        }
        if (existing.state === "active" && family.state !== "active") {
          existing.state = family.state;
        }
        if (existing.state === "ritual" && family.state === "bridge") {
          existing.state = "bridge";
        }
      } else {
        familyMap.set(family.familyId, {
          familyId: family.familyId,
          anchorSequence: family.anchorSequence,
          state: family.state,
          variantSequences: [...family.variantSequences].sort(),
          carrierAgentIds: [...family.carrierAgentIds].sort(),
          pairIds: [dialect.pairId],
          originPairId: family.originPairId,
          propagationDepth: 1,
          lastSeenAt: family.lastSeenAt,
          timeline,
        });
      }

      if (family.originPairId !== dialect.pairId) {
        for (const carrierAgentId of family.carrierAgentIds) {
          const bridgeId = `${carrierAgentId}:${family.familyId}:${family.originPairId}:${dialect.pairId}`;

          if (!bridgeMap.has(bridgeId)) {
            bridgeMap.set(bridgeId, {
              agentId: carrierAgentId,
              familyId: family.familyId,
              anchorSequence: family.anchorSequence,
              fromPairId: family.originPairId,
              toPairId: dialect.pairId,
              firstCarriedAt: family.firstSeenAt,
              status: family.state === "bridge" ? "confirmed" : "carrying",
              confirmedAt: family.state === "bridge" ? family.lastSeenAt : undefined,
            });
          }
        }
      }
    }
  }

  for (const family of familyMap.values()) {
    family.timeline = family.timeline
      .reduce((entries, entry) => {
        const existing = entries.find((candidate) => candidate.exchangeId === entry.exchangeId && candidate.pairId === entry.pairId);
        if (!existing) {
          entries.push(entry);
          return entries;
        }

        existing.kinds = sortedKinds(new Set([...existing.kinds, ...entry.kinds]));
        return entries;
      }, [] as UniverseMorphologyResponse["families"][number]["timeline"])
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    family.propagationDepth = family.pairIds.length;
  }

  return universeMorphologyResponseSchema.parse({
    evaluatedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    pairs,
    families: Array.from(familyMap.values()).sort((left, right) => {
      if (right.propagationDepth !== left.propagationDepth) {
        return right.propagationDepth - left.propagationDepth;
      }

      return right.lastSeenAt.localeCompare(left.lastSeenAt);
    }),
    bridges: Array.from(bridgeMap.values()).sort((left, right) => right.firstCarriedAt.localeCompare(left.firstCarriedAt)),
    events: recentEvents.slice(0, 32),
  });
}
