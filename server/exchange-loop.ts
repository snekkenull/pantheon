import { randomUUID } from "node:crypto";

import { ensureEmojiOnly, normalizeSymbol } from "./emoji.js";
import {
  appendExchangeEvent,
  appendLineage,
  invalidateGraphCache,
  loadDialectsStore,
  loadExchangesStore,
  loadStore,
  saveDialectsStore,
  saveStore,
} from "./store.js";
import type {
  ConsciousnessAgent,
  DialectFamily,
  ExchangeEvent,
  ExchangeRelation,
  ExchangeTurn,
  PairDialect,
  SchedulerBucket,
  SymbolState,
} from "./types.js";

const DEFAULT_PULSE_INTERVAL_MS = 30_000;
const DEFAULT_MAX_PAIRS_PER_PULSE = 3;
const TURN_COUNT = 4;

type PairBucket = SchedulerBucket;

type PairCandidate = {
  left: ConsciousnessAgent;
  right: ConsciousnessAgent;
  pairId: string;
  bucket: PairBucket;
  priority: number;
  recentAt: string | null;
};

type ExchangeCompletion = {
  model: string;
  turns: ExchangeTurn[];
};

export type ExchangeGenerator = (
  left: ConsciousnessAgent,
  right: ConsciousnessAgent,
  dialect: PairDialect | null,
) => Promise<ExchangeCompletion>;

type PulseConfig = {
  enabled: boolean;
  intervalMs: number;
  maxPairsPerPulse: number;
};

type ClassifiedSequence = {
  relations: ExchangeRelation[];
  nextFamilies: DialectFamily[];
};

let registeredExchangeGenerator: ExchangeGenerator | null = null;

function parsePositiveInteger(rawValue: string | undefined, fallback: number): number {
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPulseConfig(env: NodeJS.ProcessEnv = process.env): PulseConfig {
  return {
    enabled: env.PANTHEON_EXCHANGE_ENABLED === "1",
    intervalMs: parsePositiveInteger(env.PANTHEON_EXCHANGE_INTERVAL_MS, DEFAULT_PULSE_INTERVAL_MS),
    maxPairsPerPulse: parsePositiveInteger(env.PANTHEON_EXCHANGE_MAX_PAIRS, DEFAULT_MAX_PAIRS_PER_PULSE),
  };
}

export function getAutomaticPulseState(env: NodeJS.ProcessEnv = process.env): {
  shouldStart: boolean;
  reason: string | null;
  config: PulseConfig;
} {
  const config = getPulseConfig(env);

  if (!config.enabled) {
    return {
      shouldStart: false,
      reason: "Automatic exchange pulse disabled; set PANTHEON_EXCHANGE_ENABLED=1 to enable it.",
      config,
    };
  }

  if (!registeredExchangeGenerator) {
    return {
      shouldStart: false,
      reason: "Automatic exchange pulse disabled; no exchange protocol adapter is registered.",
      config,
    };
  }

  return {
    shouldStart: true,
    reason: null,
    config,
  };
}

export function buildPairId(leftId: string, rightId: string): string {
  return [leftId, rightId].sort().join("::");
}

export function registerExchangeGenerator(generator: ExchangeGenerator | null): void {
  registeredExchangeGenerator = generator;
}

export function hasExchangeGenerator(): boolean {
  return registeredExchangeGenerator !== null;
}

export async function generateExchange(
  left: ConsciousnessAgent,
  right: ConsciousnessAgent,
  dialect: PairDialect | null,
  exchangeGenerator: ExchangeGenerator | null = registeredExchangeGenerator,
): Promise<ExchangeCompletion> {
  if (!exchangeGenerator) {
    throw new Error("No exchange protocol adapter is registered");
  }

  return exchangeGenerator(left, right, dialect);
}

export function parseTurns(rawContent: string, leftId: string, rightId: string): ExchangeTurn[] {
  const lines = rawContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== TURN_COUNT) {
    throw new Error(`Expected ${TURN_COUNT} emoji lines, received ${lines.length}`);
  }

  return lines.map((line, index) => {
    const normalizedLine = ensureEmojiOnly(line);
    const sequences = normalizedLine
      .split(" ")
      .map((sequence) => ensureEmojiOnly(sequence))
      .filter(Boolean);

    if (sequences.length < 1 || sequences.length > 2) {
      throw new Error("Each turn must contain 1 or 2 emoji sequences");
    }

    return {
      speakerId: index % 2 === 0 ? leftId : rightId,
      sequences,
    };
  });
}

function splitSequenceUnits(sequence: string): string[] {
  return sequence.split(" ").filter(Boolean);
}

function sequenceSimilarity(left: string, right: string): number {
  const leftUnits = new Set(splitSequenceUnits(left));
  const rightUnits = new Set(splitSequenceUnits(right));
  const union = new Set([...leftUnits, ...rightUnits]);
  const intersection = Array.from(leftUnits).filter((unit) => rightUnits.has(unit));
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function sortByCreatedAtAscending(left: { createdAt: string }, right: { createdAt: string }): number {
  return left.createdAt.localeCompare(right.createdAt);
}

function completedPairEvents(events: ExchangeEvent[], pairId: string): ExchangeEvent[] {
  return events
    .filter((event) => event.status === "completed" && event.pairId === pairId)
    .sort(sortByCreatedAtAscending);
}

function completedFamilyEvents(events: ExchangeEvent[], pairId: string, familyId: string): ExchangeEvent[] {
  return completedPairEvents(events, pairId).filter((event) =>
    event.relations.some((relation) => relation.familyId === familyId),
  );
}

function familySpeakersInEvent(event: ExchangeEvent, familyId: string): string[] {
  return dedupeStrings(
    event.relations
      .filter((relation) => relation.familyId === familyId)
      .map((relation) => relation.speakerId),
  );
}

function familyGap(events: ExchangeEvent[], pairId: string, familyId: string): number {
  const history = completedPairEvents(events, pairId);
  let gap = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index];
    if (event.relations.some((relation) => relation.familyId === familyId)) {
      return gap;
    }
    gap += 1;
  }

  return gap;
}

function familyHasRecentDerivative(
  dialect: PairDialect | null,
  sequence: string,
  eventHistory: ExchangeEvent[],
): DialectFamily | null {
  if (!dialect) {
    return null;
  }

  const recentExchangeIds = completedPairEvents(eventHistory, dialect.pairId)
    .slice(-3)
    .map((event) => event.exchangeId);

  for (const family of dialect.families) {
    if (!family.exchangeIds.some((exchangeId) => recentExchangeIds.includes(exchangeId))) {
      continue;
    }

    const familySequences = [family.anchorSequence, ...family.variantSequences];
    if (familySequences.some((candidate) => sequenceSimilarity(candidate, sequence) >= 0.5)) {
      return family;
    }
  }

  return null;
}

function familyQualifiesForRitual(events: ExchangeEvent[], pairId: string, familyId: string): boolean {
  const usage = completedFamilyEvents(events, pairId, familyId);
  if (usage.length < 3) {
    return false;
  }

  const timestamps = new Set(usage.map((event) => event.createdAt));
  if (timestamps.size < 2) {
    return false;
  }

  const dualSpeakerExchanges = usage.filter((event) => familySpeakersInEvent(event, familyId).length >= 2).length;
  return dualSpeakerExchanges >= 2;
}

function familyQualifiesForBridge(events: ExchangeEvent[], pairId: string, family: DialectFamily): boolean {
  if (family.originPairId === pairId) {
    return false;
  }

  if (!familyQualifiesForRitual(events, family.originPairId, family.familyId)) {
    return false;
  }

  const usage = completedFamilyEvents(events, pairId, family.familyId);
  const carried = usage
    .flatMap((event) =>
      event.relations
        .filter((relation) => relation.familyId === family.familyId && relation.kind === "carried")
        .map((relation) => ({
          createdAt: event.createdAt,
          carrierAgentId: relation.carriedByAgentId ?? relation.speakerId,
        })),
    )
    .sort(sortByCreatedAtAscending);

  if (carried.length === 0) {
    return false;
  }

  return carried.some((carry) =>
    usage.some(
      (event) =>
        event.createdAt > carry.createdAt &&
        event.relations.some(
          (relation) => relation.familyId === family.familyId && relation.speakerId !== carry.carrierAgentId,
        ),
    ),
  );
}

function historicalMirrorApplies(
  familyId: string,
  pairId: string,
  speakerId: string,
  eventHistory: ExchangeEvent[],
): boolean {
  const pairHistory = completedPairEvents(eventHistory, pairId);
  if (pairHistory.length === 0) {
    return false;
  }

  const lastPairEvent = pairHistory[pairHistory.length - 1];
  if (!lastPairEvent.relations.some((relation) => relation.familyId === familyId)) {
    return false;
  }

  const speakers = familySpeakersInEvent(lastPairEvent, familyId);
  return speakers.length > 0 && speakers.every((candidate) => candidate !== speakerId);
}

function familyStateFromHistory(events: ExchangeEvent[], pairId: string, family: DialectFamily): DialectFamily["state"] {
  if (familyGap(events, pairId, family.familyId) >= 3) {
    return "dormant";
  }

  if (familyQualifiesForBridge(events, pairId, family)) {
    return "bridge";
  }

  if (familyQualifiesForRitual(events, pairId, family.familyId)) {
    return "ritual";
  }

  return "active";
}

function bridgePotentialScore(agent: ConsciousnessAgent, candidate: ConsciousnessAgent, dialects: PairDialect[]): number {
  const candidateSequences = new Set(candidate.symbols.map((symbol) => symbol.sequence));
  let score = 0;

  for (const dialect of dialects) {
    if (dialect.agentIds.includes(candidate.agentId) || !dialect.agentIds.includes(agent.agentId)) {
      continue;
    }

    for (const family of dialect.families) {
      if (family.state !== "ritual" && family.state !== "bridge") {
        continue;
      }

      const sequences = [family.anchorSequence, ...family.variantSequences];
      if (sequences.some((sequence) => candidateSequences.has(sequence))) {
        score += family.state === "bridge" ? 3 : 2;
      }
    }
  }

  return score;
}

function dialectPriority(bucket: PairBucket, dialect: PairDialect | null, bridgeScore: number): number {
  const families = dialect?.families ?? [];
  const liveCount = families.filter((family) => family.state === "active" || family.state === "ritual" || family.state === "bridge").length;
  const ritualCount = families.filter((family) => family.state === "ritual").length;
  const bridgeCount = families.filter((family) => family.state === "bridge").length;
  const dormantCount = families.filter((family) => family.state === "dormant").length;

  if (bucket === "resonance") {
    return bridgeCount * 8 + ritualCount * 5 + liveCount * 2;
  }

  if (bucket === "bridge-reactivation") {
    return bridgeScore * 4 + dormantCount * 3 + ritualCount;
  }

  return bridgeScore;
}

function classifyPairBucket(
  left: ConsciousnessAgent,
  right: ConsciousnessAgent,
  dialects: PairDialect[],
): { bucket: PairBucket; priority: number; recentAt: string | null } {
  const pairId = buildPairId(left.agentId, right.agentId);
  const dialect = dialects.find((entry) => entry.pairId === pairId) ?? null;
  const hasLiveDialect = Boolean(
    dialect && dialect.families.some((family) => family.state === "active" || family.state === "ritual" || family.state === "bridge"),
  );
  const bridgeScore = bridgePotentialScore(left, right, dialects) + bridgePotentialScore(right, left, dialects);

  if (hasLiveDialect) {
    return {
      bucket: "resonance",
      priority: dialectPriority("resonance", dialect, bridgeScore),
      recentAt: dialect?.lastExchangeAt ?? null,
    };
  }

  if ((dialect?.families.some((family) => family.state === "dormant") ?? false) || bridgeScore > 0) {
    return {
      bucket: "bridge-reactivation",
      priority: dialectPriority("bridge-reactivation", dialect, bridgeScore),
      recentAt: dialect?.lastExchangeAt ?? null,
    };
  }

  return {
    bucket: "tension",
    priority: dialectPriority("tension", dialect, bridgeScore),
    recentAt: dialect?.lastExchangeAt ?? null,
  };
}

function sortCandidates(candidates: PairCandidate[]): PairCandidate[] {
  return [...candidates].sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }

    const leftRecent = left.recentAt ?? "";
    const rightRecent = right.recentAt ?? "";
    if (rightRecent !== leftRecent) {
      return rightRecent.localeCompare(leftRecent);
    }

    return left.pairId.localeCompare(right.pairId);
  });
}

function selectEligiblePairs(
  agents: ConsciousnessAgent[],
  dialects: PairDialect[],
  maxPairsPerPulse: number,
): PairCandidate[] {
  const buckets: Record<PairBucket, PairCandidate[]> = {
    resonance: [],
    "bridge-reactivation": [],
    tension: [],
  };

  for (let index = 0; index < agents.length; index += 1) {
    for (let nestedIndex = index + 1; nestedIndex < agents.length; nestedIndex += 1) {
      const left = agents[index];
      const right = agents[nestedIndex];
      const pairId = buildPairId(left.agentId, right.agentId);
      const bucketInfo = classifyPairBucket(left, right, dialects);

      buckets[bucketInfo.bucket].push({
        left,
        right,
        pairId,
        bucket: bucketInfo.bucket,
        priority: bucketInfo.priority,
        recentAt: bucketInfo.recentAt,
      });
    }
  }

  const orderedBuckets: PairBucket[] = ["resonance", "bridge-reactivation", "tension"];
  const sortedBuckets = {
    resonance: sortCandidates(buckets.resonance),
    "bridge-reactivation": sortCandidates(buckets["bridge-reactivation"]),
    tension: sortCandidates(buckets.tension),
  };
  const selected: PairCandidate[] = [];
  const seen = new Set<string>();

  for (const bucket of orderedBuckets) {
    const next = sortedBuckets[bucket].find((candidate) => !seen.has(candidate.pairId));
    if (!next) {
      continue;
    }

    selected.push(next);
    seen.add(next.pairId);
  }

  for (const bucket of orderedBuckets) {
    for (const candidate of sortedBuckets[bucket]) {
      if (selected.length >= maxPairsPerPulse) {
        return selected.slice(0, maxPairsPerPulse);
      }

      if (seen.has(candidate.pairId)) {
        continue;
      }

      selected.push(candidate);
      seen.add(candidate.pairId);
    }
  }

  return selected.slice(0, maxPairsPerPulse);
}

function familyMatchesSequence(family: DialectFamily, sequence: string): boolean {
  return family.anchorSequence === sequence || family.variantSequences.includes(sequence);
}

function cloneFamilyForPair(family: DialectFamily, pair: PairCandidate): DialectFamily {
  return {
    ...family,
    variantSequences: [...family.variantSequences],
    exchangeIds: [...family.exchangeIds],
    participantAgentIds: dedupeStrings([...family.participantAgentIds, pair.left.agentId, pair.right.agentId]),
    carrierAgentIds: [...family.carrierAgentIds],
  };
}

function findCarriedFamily(
  currentPairId: string,
  speakerId: string,
  sequence: string,
  dialects: PairDialect[],
): DialectFamily | null {
  for (const dialect of dialects) {
    if (dialect.pairId === currentPairId || !dialect.agentIds.includes(speakerId)) {
      continue;
    }

    for (const family of dialect.families) {
      if (family.state !== "ritual" && family.state !== "bridge") {
        continue;
      }

      if ([family.anchorSequence, ...family.variantSequences].some((candidate) => candidate === sequence || sequenceSimilarity(candidate, sequence) >= 0.5)) {
        return family;
      }
    }
  }

  return null;
}

function classifySequences(options: {
  dialect: PairDialect | null;
  pair: PairCandidate;
  turns: ExchangeTurn[];
  now: Date;
  dialectStore: PairDialect[];
  eventHistory: ExchangeEvent[];
}): ClassifiedSequence {
  const relations: ExchangeRelation[] = [];
  const familyMap = new Map<string, DialectFamily>(
    (options.dialect?.families ?? []).map((family) => [family.familyId, cloneFamilyForPair(family, options.pair)]),
  );
  const seenByExchangeFamily = new Map<string, Set<string>>();

  for (const turn of options.turns) {
    for (const rawSequence of turn.sequences) {
      const sequence = normalizeSymbol(rawSequence);
      const exactFamily = Array.from(familyMap.values()).find((family) => familyMatchesSequence(family, sequence)) ?? null;
      const carriedSource = exactFamily
        ? null
        : findCarriedFamily(options.pair.pairId, turn.speakerId, sequence, options.dialectStore);
      const mutatedSource = exactFamily || carriedSource
        ? null
        : familyHasRecentDerivative(options.dialect, sequence, options.eventHistory);

      let family = exactFamily;
      let kind: ExchangeRelation["kind"];
      let derivedFromFamilyId: string | undefined;
      let carriedByAgentId: string | undefined;

      if (family) {
        const seenSpeakers = seenByExchangeFamily.get(family.familyId) ?? new Set<string>();

        if (familyGap(options.eventHistory, options.pair.pairId, family.familyId) >= 3) {
          kind = "reactivated";
        } else if (seenSpeakers.size > 0 && !seenSpeakers.has(turn.speakerId)) {
          kind = "mirrored";
        } else if (historicalMirrorApplies(family.familyId, options.pair.pairId, turn.speakerId, options.eventHistory)) {
          kind = "mirrored";
        } else {
          kind = "echoed";
        }
      } else if (carriedSource) {
        family = cloneFamilyForPair(carriedSource, options.pair);
        kind = "carried";
        derivedFromFamilyId = carriedSource.familyId;
        carriedByAgentId = turn.speakerId;
        if (!familyMatchesSequence(family, sequence)) {
          family.variantSequences = dedupeStrings([...family.variantSequences, sequence]);
        }
      } else if (mutatedSource) {
        family = cloneFamilyForPair(mutatedSource, options.pair);
        kind = "mutated";
        derivedFromFamilyId = mutatedSource.familyId;
        if (!familyMatchesSequence(family, sequence)) {
          family.variantSequences = dedupeStrings([...family.variantSequences, sequence]);
        }
      } else {
        kind = "seeded";
        family = {
          familyId: randomUUID(),
          anchorSequence: sequence,
          variantSequences: [],
          state: "active",
          firstSeenAt: options.now.toISOString(),
          lastSeenAt: options.now.toISOString(),
          exchangeIds: [],
          participantAgentIds: [options.pair.left.agentId, options.pair.right.agentId],
          carrierAgentIds: [],
          originPairId: options.pair.pairId,
        };
      }

      family.lastSeenAt = options.now.toISOString();
      family.exchangeIds = dedupeStrings([...family.exchangeIds, "pending"]);
      family.participantAgentIds = dedupeStrings([
        ...family.participantAgentIds,
        options.pair.left.agentId,
        options.pair.right.agentId,
      ]);

      if (kind === "carried") {
        family.carrierAgentIds = dedupeStrings([...family.carrierAgentIds, turn.speakerId]);
      }

      familyMap.set(family.familyId, family);
      const seenSpeakers = seenByExchangeFamily.get(family.familyId) ?? new Set<string>();
      seenSpeakers.add(turn.speakerId);
      seenByExchangeFamily.set(family.familyId, seenSpeakers);

      relations.push({
        relationId: randomUUID(),
        kind,
        familyId: family.familyId,
        sequence,
        speakerId: turn.speakerId,
        pairId: options.pair.pairId,
        createdAt: options.now.toISOString(),
        derivedFromFamilyId,
        carriedByAgentId,
      });
    }
  }

  return {
    relations,
    nextFamilies: Array.from(familyMap.values()),
  };
}

function finalizeFamilies(
  families: DialectFamily[],
  exchangeId: string,
  pairId: string,
  eventHistory: ExchangeEvent[],
): DialectFamily[] {
  return families.map((family) => {
    const nextFamily = {
      ...family,
      exchangeIds: family.exchangeIds.map((id) => (id === "pending" ? exchangeId : id)),
    };

    return {
      ...nextFamily,
      state: familyStateFromHistory(eventHistory, pairId, nextFamily),
    };
  });
}

function symbolStateForRelation(relation: ExchangeRelation): SymbolState {
  if (relation.kind === "carried") {
    return "bridge";
  }

  if (relation.kind === "mirrored") {
    return "ritual";
  }

  if (relation.kind === "seeded") {
    return "seed";
  }

  return "active";
}

function updateAgentSymbols(
  pair: PairCandidate,
  relations: ExchangeRelation[],
  storeAgents: ConsciousnessAgent[],
  now: Date,
): void {
  const targets = storeAgents.filter((agent) => agent.agentId === pair.left.agentId || agent.agentId === pair.right.agentId);

  for (const agent of targets) {
    const agentRelations = relations.filter((relation) => relation.speakerId === agent.agentId);
    let changed = false;

    for (const relation of agentRelations) {
      const existing = agent.symbols.find((symbol) => symbol.sequence === relation.sequence);

      if (existing) {
        const nextState = symbolStateForRelation(relation);
        if (existing.state !== nextState) {
          existing.state = nextState;
          changed = true;
        }
        existing.traces = dedupeStrings([...existing.traces, `exchange:${relation.familyId}:${relation.kind}:${now.toISOString()}`]);
        existing.relations = dedupeStrings([...existing.relations, relation.familyId]);
        continue;
      }

      agent.symbols.push({
        id: randomUUID(),
        sequence: relation.sequence,
        state: symbolStateForRelation(relation),
        origins: relation.kind === "carried" ? ["carry"] : relation.kind === "mutated" ? ["mutation"] : ["exchange"],
        traces: [`exchange:${relation.familyId}:${relation.kind}:${now.toISOString()}`],
        relations: [relation.familyId],
      });
      changed = true;
    }

    if (changed) {
      agent.updatedAt = now.toISOString();
    }
  }
}

function appendExchangeLineage(pair: PairCandidate, relations: ExchangeRelation[], now: Date): void {
  const grouped = new Map<string, ExchangeRelation[]>();

  for (const relation of relations) {
    const bucket = grouped.get(relation.speakerId) ?? [];
    bucket.push(relation);
    grouped.set(relation.speakerId, bucket);
  }

  for (const agentId of [pair.left.agentId, pair.right.agentId]) {
    const agentRelations = grouped.get(agentId) ?? [];
    if (agentRelations.length === 0) {
      continue;
    }

    appendLineage({
      agentId,
      timestamp: now.toISOString(),
      changes: agentRelations.map((relation) => ({
        entityType: "symbol",
        entityId: relation.familyId,
        label: relation.sequence,
        action:
          relation.kind === "seeded"
            ? "add"
            : relation.kind === "echoed" || relation.kind === "mirrored" || relation.kind === "reactivated"
              ? "state-change"
              : "relate",
        after: {
          state: relation.kind,
          relationIds: [relation.relationId],
        },
      })),
    });
  }
}

export async function runExchangePulse(options?: {
  now?: Date;
  exchangeGenerator?: ExchangeGenerator | null;
  minAffinity?: number;
}): Promise<ExchangeEvent[]> {
  const now = options?.now ?? new Date();
  const exchangeGenerator = options?.exchangeGenerator ?? registeredExchangeGenerator;
  const config = getPulseConfig();
  const store = loadStore();
  const dialectsStore = loadDialectsStore();
  const exchangeStore = loadExchangesStore();
  const existingEvents = exchangeStore.events;
  const candidates = selectEligiblePairs(store.agents, dialectsStore.dialects, config.maxPairsPerPulse);
  const events: ExchangeEvent[] = [];

  for (const candidate of candidates) {
    const currentDialect = dialectsStore.dialects.find((dialect) => dialect.pairId === candidate.pairId) ?? null;

    try {
      const completion = await generateExchange(candidate.left, candidate.right, currentDialect, exchangeGenerator);
      const classified = classifySequences({
        dialect: currentDialect,
        pair: candidate,
        turns: completion.turns,
        now,
        dialectStore: dialectsStore.dialects,
        eventHistory: existingEvents,
      });
      const exchangeId = randomUUID();
      const event: ExchangeEvent = {
        exchangeId,
        createdAt: now.toISOString(),
        pairId: candidate.pairId,
        initiatorId: candidate.left.agentId,
        targetId: candidate.right.agentId,
        model: completion.model,
        status: "completed",
        turns: completion.turns,
        relations: classified.relations,
      };
      const nextHistory = [...existingEvents, event];
      const finalizedFamilies = finalizeFamilies(classified.nextFamilies, exchangeId, candidate.pairId, nextHistory);
      const nextDialect: PairDialect = {
        pairId: candidate.pairId,
        agentIds: [candidate.left.agentId, candidate.right.agentId].sort() as [string, string],
        families: finalizedFamilies,
        lastExchangeAt: now.toISOString(),
      };
      const nextDialects = dialectsStore.dialects.filter((dialect) => dialect.pairId !== nextDialect.pairId);
      nextDialects.push(nextDialect);
      dialectsStore.dialects = nextDialects;
      dialectsStore.updatedAt = now.toISOString();
      saveDialectsStore(dialectsStore);
      appendExchangeEvent(event);
      existingEvents.push(event);
      updateAgentSymbols(candidate, event.relations, store.agents, now);
      appendExchangeLineage(candidate, event.relations, now);
      saveStore(store);
      invalidateGraphCache();
      events.push(event);
    } catch (error) {
      const event: ExchangeEvent = {
        exchangeId: randomUUID(),
        createdAt: now.toISOString(),
        pairId: candidate.pairId,
        initiatorId: candidate.left.agentId,
        targetId: candidate.right.agentId,
        model: "protocol-adapter",
        status: "failed",
        turns: [],
        relations: [],
        failureReason: error instanceof Error ? error.message : "Unknown exchange failure",
      };
      appendExchangeEvent(event);
      existingEvents.push(event);
      events.push(event);
    }
  }

  return events;
}

export function getPulseIntervalMs(): number {
  return getPulseConfig().intervalMs;
}

export function listAgentExchanges(agentId: string): { events: ExchangeEvent[]; dialects: PairDialect[] } {
  const events = loadExchangesStore().events
    .filter((event) => event.initiatorId === agentId || event.targetId === agentId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 12);
  const dialects = loadDialectsStore().dialects
    .filter((dialect) => dialect.agentIds.includes(agentId))
    .sort((left, right) => (right.lastExchangeAt ?? "").localeCompare(left.lastExchangeAt ?? ""))
    .slice(0, 8);

  return { events, dialects };
}
