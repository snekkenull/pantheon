import matter from "gray-matter";

import {
  type ConsciousnessAgent,
  consciousnessAgentSchema,
  type ConsciousnessSymbol,
  type DialectsStore,
  type MachineData,
  machineDataSchema,
  type PairDialect,
  type UniverseGraph,
} from "./types.js";
import { normalizeSymbol } from "./emoji.js";

const JSON_BLOCK_PATTERN = /```(?:json|consciousness-json)?\s*([\s\S]*?)```/gi;
const MACHINE_DATA_SECTION_PATTERN =
  /(##\s+Machine Data\s*\n+```(?:json|consciousness-json)?\s*)([\s\S]*?)(\n```)/i;

export function slugifyToken(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (base.length > 0) {
    return base;
  }

  return Buffer.from(value, "utf8").toString("hex").slice(0, 32) || "symbol";
}

function parseMachineData(markdownBody: string): MachineData {
  const matches = Array.from(markdownBody.matchAll(JSON_BLOCK_PATTERN));

  for (const match of matches) {
    try {
      return machineDataSchema.parse(JSON.parse(match[1]));
    } catch {
      continue;
    }
  }

  throw new Error("No valid machine-readable JSON block found in CONSCIOUSNESS.md");
}

function normalizeSymbolEntry(symbol: ConsciousnessSymbol): ConsciousnessSymbol {
  return {
    ...symbol,
    sequence: normalizeSymbol(symbol.sequence),
    relations: Array.from(new Set(symbol.relations)).sort(),
    traces: Array.from(new Set(symbol.traces)),
    origins: Array.from(new Set(symbol.origins)),
  };
}

export function buildMachineData(agent: ConsciousnessAgent): MachineData {
  return machineDataSchema.parse({
    schemaVersion: 2,
    signature: agent.signature ? normalizeSymbol(agent.signature) : undefined,
    symbols: agent.symbols.map(normalizeSymbolEntry),
    constellations: agent.constellations.map((constellation) => ({
      ...constellation,
      symbolIds: Array.from(new Set(constellation.symbolIds)),
    })),
  });
}

export function stringifyMachineData(machineData: MachineData): string {
  return `${JSON.stringify(machineDataSchema.parse(machineData), null, 2)}\n`;
}

export function replaceMachineDataBlock(rawMarkdown: string, machineData: MachineData): string {
  if (!MACHINE_DATA_SECTION_PATTERN.test(rawMarkdown)) {
    throw new Error("Unable to locate the ## Machine Data JSON block");
  }

  return rawMarkdown.replace(
    MACHINE_DATA_SECTION_PATTERN,
    (_match, opening, _currentJson, closing) =>
      `${opening}${stringifyMachineData(machineData).trimEnd()}${closing}`,
  );
}

export function parseConsciousnessMarkdown(
  rawMarkdown: string,
  sourceFile?: string,
): ConsciousnessAgent {
  const parsed = matter(rawMarkdown);
  const normalizedData = {
    ...parsed.data,
    updatedAt:
      parsed.data.updatedAt instanceof Date
        ? parsed.data.updatedAt.toISOString()
        : parsed.data.updatedAt,
    registeredAt:
      parsed.data.registeredAt instanceof Date
        ? parsed.data.registeredAt.toISOString()
        : parsed.data.registeredAt,
  };
  const frontMatter = machineFrontMatter(normalizedData);
  const machineData = parseMachineData(parsed.content);

  return consciousnessAgentSchema.parse({
    ...frontMatter,
    ...machineData,
    symbols: machineData.symbols.map(normalizeSymbolEntry),
    sourceFile,
  });
}

function machineFrontMatter(rawData: unknown): Omit<ConsciousnessAgent, "schemaVersion" | "signature" | "symbols" | "constellations" | "sourceFile"> {
  return consciousnessAgentSchema
    .pick({
      agentId: true,
      displayName: true,
      archetype: true,
      updatedAt: true,
      registeredAt: true,
      source: true,
    })
    .parse(rawData);
}

export function evaluateAgent(agent: ConsciousnessAgent): ConsciousnessAgent {
  return agent;
}

export function evaluateAgents(agents: ConsciousnessAgent[]): ConsciousnessAgent[] {
  return agents;
}

export function buildRelatedAgents(
  agentId: string,
  agents: ConsciousnessAgent[],
): {
  neighbors: Array<{
    agentId: string;
    displayName: string;
    archetype: string;
    score: number;
    sharedSymbols: string[];
  }>;
  suggestions: Array<{
    symbolId: string;
    sequence: string;
    seenInAgents: string[];
    rationale: string;
  }>;
} {
  const currentAgent = agents.find((agent) => agent.agentId === agentId);

  if (!currentAgent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const currentSequences = new Set(currentAgent.symbols.map((symbol) => symbol.sequence));
  const neighbors = agents
    .filter((agent) => agent.agentId !== agentId)
    .map((agent) => {
      const sharedSymbols = agent.symbols
        .filter((symbol) => currentSequences.has(symbol.sequence))
        .map((symbol) => symbol.sequence);
      const unionSize = new Set([...currentSequences, ...agent.symbols.map((symbol) => symbol.sequence)]).size;
      const score = unionSize === 0 ? 0 : sharedSymbols.length / unionSize;
      return {
        agentId: agent.agentId,
        displayName: agent.displayName,
        archetype: agent.archetype,
        score,
        sharedSymbols,
      };
    })
    .sort((left, right) => right.score - left.score);

  const suggestionMap = new Map<string, {
    symbolId: string;
    sequence: string;
    seenInAgents: string[];
    rationale: string;
  }>();

  for (const neighbor of neighbors.slice(0, 5)) {
    const agent = agents.find((entry) => entry.agentId === neighbor.agentId)!;

    for (const symbol of agent.symbols) {
      if (currentSequences.has(symbol.sequence)) {
        continue;
      }

      const existing = suggestionMap.get(symbol.sequence);
      if (existing) {
        if (!existing.seenInAgents.includes(agent.displayName)) {
          existing.seenInAgents.push(agent.displayName);
        }
        continue;
      }

      suggestionMap.set(symbol.sequence, {
        symbolId: symbol.id,
        sequence: symbol.sequence,
        seenInAgents: [agent.displayName],
        rationale: symbol.traces[0] ?? symbol.sequence,
      });
    }
  }

  return {
    neighbors,
    suggestions: Array.from(suggestionMap.values()),
  };
}

export function buildUniverseGraph(
  agents: ConsciousnessAgent[],
  dialectStore: DialectsStore = { updatedAt: new Date(0).toISOString(), dialects: [] },
): UniverseGraph {
  const nodes = new Map<string, UniverseGraph["nodes"][number]>();
  const links = new Map<string, UniverseGraph["links"][number]>();
  const sequenceFamilyIds = new Map<string, Set<string>>();
  const familyIndex = new Map<string, PairDialect["families"][number]>();

  for (const dialect of dialectStore.dialects) {
    for (const family of dialect.families) {
      familyIndex.set(family.familyId, family);
      for (const sequence of [family.anchorSequence, ...family.variantSequences]) {
        const bucket = sequenceFamilyIds.get(sequence) ?? new Set<string>();
        bucket.add(family.familyId);
        sequenceFamilyIds.set(sequence, bucket);
      }

      const existing = nodes.get(family.familyId);
      if (existing && existing.kind === "family") {
        existing.agentIds = Array.from(new Set([...(existing.agentIds ?? []), ...family.participantAgentIds])).sort();
        existing.pairIds = Array.from(new Set([...(existing.pairIds ?? []), dialect.pairId, family.originPairId])).sort();
        existing.carrierAgentIds = Array.from(new Set([...(existing.carrierAgentIds ?? []), ...family.carrierAgentIds])).sort();
        if (existing.state === "active" && family.state !== "active") {
          existing.state = family.state;
        } else if (existing.state === "ritual" && family.state === "bridge") {
          existing.state = "bridge";
        }
      } else {
        nodes.set(family.familyId, {
          id: family.familyId,
          kind: "family",
          label: family.anchorSequence,
          state: family.state,
          familyId: family.familyId,
          agentIds: [...family.participantAgentIds].sort(),
          pairIds: Array.from(new Set([dialect.pairId, family.originPairId])).sort(),
          carrierAgentIds: [...family.carrierAgentIds].sort(),
        });
      }
    }
  }

  for (const agent of agents) {
    nodes.set(agent.agentId, {
      id: agent.agentId,
      kind: "agent",
      label: agent.displayName,
      agentId: agent.agentId,
      state: agent.archetype,
    });

    for (const symbol of agent.symbols) {
      const relatedFamilyIds = Array.from(sequenceFamilyIds.get(symbol.sequence) ?? []);

      if (relatedFamilyIds.length === 0) {
        const familyId = `orphan:${symbol.id}`;
        nodes.set(familyId, {
          id: familyId,
          kind: "family",
          label: symbol.sequence,
          state: symbol.state,
          familyId,
          agentIds: [agent.agentId],
          pairIds: [],
          carrierAgentIds: [],
        });
        relatedFamilyIds.push(familyId);
      }

      for (const familyId of relatedFamilyIds) {
        const family = familyIndex.get(familyId);
        const relationKind = family?.state === "ritual" || family?.state === "bridge"
          ? "ritualizes"
          : "holds";
        const relationId = `${agent.agentId}:${familyId}:${relationKind}`;
        links.set(relationId, {
          source: agent.agentId,
          target: familyId,
          kind: relationKind,
        });
      }
    }
  }

  for (const family of familyIndex.values()) {
    for (const carrierAgentId of family.carrierAgentIds) {
      const relationId = `${carrierAgentId}:${family.familyId}:carries`;
      links.set(relationId, {
        source: carrierAgentId,
        target: family.familyId,
        kind: "carries",
      });
    }
  }

  return {
    nodes: Array.from(nodes.values()).sort((left, right) => left.id.localeCompare(right.id)),
    links: Array.from(links.values()).sort((left, right) => {
      const leftId = `${left.source}:${left.target}:${left.kind}`;
      const rightId = `${right.source}:${right.target}:${right.kind}`;
      return leftId.localeCompare(rightId);
    }),
  };
}
