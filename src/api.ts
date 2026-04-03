export type SymbolState = "seed" | "active" | "ritual" | "bridge" | "dormant";
export type ConstellationState = "active" | "dormant";
export type DialectFamilyState = "active" | "ritual" | "bridge" | "dormant";
export type ExchangeRelationKind = "seeded" | "echoed" | "mirrored" | "mutated" | "carried" | "reactivated";
export type SchedulerBucket = "resonance" | "bridge-reactivation" | "tension";

export type ConsciousnessSymbol = {
  id: string;
  sequence: string;
  state: SymbolState;
  origins: Array<"workspace-sediment" | "exchange" | "carry" | "mutation">;
  traces: string[];
  relations: string[];
};

export type Constellation = {
  id: string;
  symbolIds: string[];
  state: ConstellationState;
};

export type ConsciousnessAgent = {
  schemaVersion: 2;
  agentId: string;
  displayName: string;
  archetype: string;
  updatedAt: string;
  evaluatedAt?: string;
  registeredAt?: string;
  signature?: string;
  symbols: ConsciousnessSymbol[];
  constellations: Constellation[];
};

export type DialectFamily = {
  familyId: string;
  anchorSequence: string;
  variantSequences: string[];
  state: DialectFamilyState;
  firstSeenAt: string;
  lastSeenAt: string;
  exchangeIds: string[];
  participantAgentIds: string[];
  carrierAgentIds: string[];
  originPairId: string;
};

export type PairDialect = {
  pairId: string;
  agentIds: [string, string];
  families: DialectFamily[];
  lastExchangeAt: string | null;
};

export type ExchangeTurn = {
  speakerId: string;
  sequences: string[];
};

export type ExchangeRelation = {
  relationId: string;
  kind: ExchangeRelationKind;
  familyId: string;
  sequence: string;
  speakerId: string;
  pairId: string;
  createdAt: string;
  derivedFromFamilyId?: string;
  carriedByAgentId?: string;
};

export type ExchangeEvent = {
  exchangeId: string;
  createdAt: string;
  pairId: string;
  initiatorId: string;
  targetId: string;
  model: string;
  status: "completed" | "failed";
  turns: ExchangeTurn[];
  relations: ExchangeRelation[];
  failureReason?: string;
};

export type AgentExchanges = {
  events: ExchangeEvent[];
  dialects: PairDialect[];
};

export type UniverseGraphNode = {
  id: string;
  kind: "agent" | "family";
  label: string;
  state?: string;
  agentId?: string;
  familyId?: string;
  agentIds?: string[];
  pairIds?: string[];
  carrierAgentIds?: string[];
};

export type UniverseGraphLink = {
  source: string;
  target: string;
  kind: "holds" | "ritualizes" | "carries";
};

export type UniverseState = {
  evaluatedAt: string;
  updatedAt: string;
  agentCount: number;
  symbolCount: number;
  dialectCount: number;
  ritualFamilyCount: number;
  bridgeFamilyCount: number;
  dormantFamilyCount: number;
  reactivationCountWindow: number;
  recentExchangeCount: number;
  agents: ConsciousnessAgent[];
  graph: {
    nodes: UniverseGraphNode[];
    links: UniverseGraphLink[];
  };
};

export type RelatedAgent = {
  agentId: string;
  displayName: string;
  archetype: string;
  score: number;
  sharedSymbols: string[];
};

export type SymbolSuggestion = {
  symbolId: string;
  sequence: string;
  seenInAgents: string[];
  rationale: string;
};

export type AgentRelations = {
  evaluatedAt: string;
  neighbors: RelatedAgent[];
  suggestions: SymbolSuggestion[];
};

export type LineageChange = {
  entityType: "symbol" | "constellation";
  entityId: string;
  label: string;
  action: "add" | "state-change" | "relate" | "remove";
  before?: {
    state?: string;
    relationIds?: string[];
    symbolIds?: string[];
  };
  after?: {
    state?: string;
    relationIds?: string[];
    symbolIds?: string[];
  };
};

export type LineageEntry = {
  agentId: string;
  timestamp: string;
  changes: LineageChange[];
  proposalId?: string;
  reviewId?: string;
};

export type LineageResponse = {
  lineage: LineageEntry[];
};

export type MorphologyTimelineEntry = {
  exchangeId: string;
  pairId: string;
  createdAt: string;
  kinds: ExchangeRelationKind[];
};

export type MorphologyPair = {
  pairId: string;
  agentIds: [string, string];
  familyIds: string[];
  ritualCount: number;
  bridgeCount: number;
  dormantCount: number;
  nextBucket: SchedulerBucket;
  lastExchangeAt: string | null;
};

export type MorphologyFamily = {
  familyId: string;
  anchorSequence: string;
  state: DialectFamilyState;
  variantSequences: string[];
  carrierAgentIds: string[];
  pairIds: string[];
  originPairId: string;
  propagationDepth: number;
  lastSeenAt: string;
  timeline: MorphologyTimelineEntry[];
};

export type MorphologyBridge = {
  agentId: string;
  familyId: string;
  anchorSequence: string;
  fromPairId: string;
  toPairId: string;
  firstCarriedAt: string;
  status: "carrying" | "confirmed";
  confirmedAt?: string;
};

export type UniverseMorphology = {
  evaluatedAt: string;
  windowStart: string;
  windowEnd: string;
  pairs: MorphologyPair[];
  families: MorphologyFamily[];
  bridges: MorphologyBridge[];
  events: ExchangeEvent[];
};

export type RegisterAgentResponse = {
  ok: boolean;
  agentId: string;
  registeredAt: string;
  updatedAt: string;
  agentCount: number;
};

export type DeleteAgentResponse = {
  ok: boolean;
  updatedAt: string;
  agentCount: number;
};

const API_BASE = import.meta.env.VITE_API_URL || "";

async function fetchJson<T>(input: string): Promise<T> {
  const response = await fetch(`${API_BASE}${input}`);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function postJson<T>(input: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${input}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed: ${response.status}`);
  }

  return data as T;
}

export function fetchUniverseState(): Promise<UniverseState> {
  return fetchJson<UniverseState>("/api/universe/state");
}

export function fetchUniverseMorphology(): Promise<UniverseMorphology> {
  return fetchJson<UniverseMorphology>("/api/universe/morphology");
}

export function fetchAgentRelations(agentId: string): Promise<AgentRelations> {
  return fetchJson<AgentRelations>(`/api/agents/${agentId}/related`);
}

export function fetchAgentExchanges(agentId: string): Promise<AgentExchanges> {
  return fetchJson<AgentExchanges>(`/api/agents/${agentId}/exchanges`);
}

export async function deleteAgent(agentId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/agents/${agentId}`, { method: "DELETE" });

  if (!response.ok) {
    throw new Error(`Delete failed: ${response.status}`);
  }
}

export async function registerAgent(agent: ConsciousnessAgent): Promise<RegisterAgentResponse> {
  return postJson<RegisterAgentResponse>(`/api/agents`, agent);
}

export function fetchAgentLineage(agentId: string): Promise<LineageResponse> {
  return fetchJson<LineageResponse>(`/api/agents/${agentId}/lineage`);
}

export function triggerExchangePulse(): Promise<{ ok: boolean; processed: number; events: ExchangeEvent[] }> {
  return postJson<{ ok: boolean; processed: number; events: ExchangeEvent[] }>(`/api/universe/exchange-pulse`, {});
}

export function triggerAutonomyPulse(): Promise<{ ok: boolean; processed: number; events: ExchangeEvent[]; morphology: UniverseMorphology }> {
  return postJson<{ ok: boolean; processed: number; events: ExchangeEvent[]; morphology: UniverseMorphology }>(
    `/api/universe/autonomy-pulse`,
    {},
  );
}
