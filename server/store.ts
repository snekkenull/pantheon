import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { buildUniverseGraph, parseConsciousnessMarkdown } from "./consciousness.js";
import {
  type ConsciousnessAgent,
  consciousnessAgentSchema,
  type ConsciousnessSymbol,
  dialectsStoreSchema,
  exchangesStoreSchema,
  type DialectsStore,
  type ExchangesStore,
  type ExchangeEvent,
  lineageEntrySchema,
  type LineageEntry,
  type PairDialect,
  type UniverseStore,
  universeStoreSchema,
} from "./types.js";
import { normalizeSymbol } from "./emoji.js";

function resolvePaths() {
  const cwd = process.cwd();
  const dataDirectory = path.join(cwd, "data");
  return {
    cwd,
    dataDirectory,
    storeFile: path.join(dataDirectory, "universe.json"),
    lineageFile: path.join(dataDirectory, "lineage.json"),
    exchangesFile: path.join(dataDirectory, "exchanges.json"),
    dialectsFile: path.join(dataDirectory, "dialects.json"),
    legacyDirectory: path.join(cwd, ".pantheon", "legacy"),
    exampleDirectory: path.join(cwd, "examples", "agents"),
  };
}

function getTrackedDataFiles(): string[] {
  const paths = resolvePaths();
  return [
    paths.storeFile,
    paths.lineageFile,
    paths.exchangesFile,
    paths.dialectsFile,
  ];
}

function ensureDataDirectory(): void {
  fs.mkdirSync(resolvePaths().dataDirectory, { recursive: true });
}

function ensureLegacyDirectory(): void {
  fs.mkdirSync(resolvePaths().legacyDirectory, { recursive: true });
}

function createStore(agents: ConsciousnessAgent[]): UniverseStore {
  return {
    updatedAt: new Date().toISOString(),
    agents,
  };
}

function generateSymbolId(): string {
  return randomUUID();
}

function normalizeAgent(agent: ConsciousnessAgent): ConsciousnessAgent {
  return consciousnessAgentSchema.parse({
    ...agent,
    signature: agent.signature ? normalizeSymbol(agent.signature) : undefined,
    symbols: agent.symbols.map((symbol: ConsciousnessSymbol) => ({
      ...symbol,
      id: symbol.id || generateSymbolId(),
      sequence: normalizeSymbol(symbol.sequence),
      traces: Array.from(new Set(symbol.traces)),
      relations: Array.from(new Set(symbol.relations)).sort(),
      origins: Array.from(new Set(symbol.origins)),
    })),
    constellations: agent.constellations.map((constellation) => ({
      ...constellation,
      symbolIds: Array.from(new Set(constellation.symbolIds)),
    })),
  });
}

function archiveGeneratedState(): void {
  const { legacyDirectory } = resolvePaths();
  ensureLegacyDirectory();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  for (const filePath of getTrackedDataFiles()) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const archiveName = `${path.basename(filePath, ".json")}-${timestamp}.json`;
    fs.copyFileSync(filePath, path.join(legacyDirectory, archiveName));
    fs.rmSync(filePath, { force: true });
  }
}

function archiveGeneratedFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const { legacyDirectory } = resolvePaths();
  ensureLegacyDirectory();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveName = `${path.basename(filePath, ".json")}-${timestamp}.json`;
  fs.copyFileSync(filePath, path.join(legacyDirectory, archiveName));
  fs.rmSync(filePath, { force: true });
}

function isLegacyUniverseStore(rawStore: unknown): boolean {
  if (!rawStore || typeof rawStore !== "object") {
    return true;
  }

  const store = rawStore as { agents?: Array<Record<string, unknown>> };
  if (!Array.isArray(store.agents)) {
    return true;
  }

  return store.agents.some((agent) => !Array.isArray(agent.symbols) || "tokens" in agent || agent.schemaVersion !== 2);
}

export function listConsciousnessFiles(directory: string): string[] {
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((entry) => path.join(directory, entry));
}

export function loadAgentsFromDirectory(directory: string): ConsciousnessAgent[] {
  return listConsciousnessFiles(directory).map((filePath) =>
    parseConsciousnessMarkdown(fs.readFileSync(filePath, "utf8"), filePath),
  );
}

function seedFromExamples(): UniverseStore {
  const { exampleDirectory } = resolvePaths();
  const agents = fs.existsSync(exampleDirectory)
    ? loadAgentsFromDirectory(exampleDirectory).map(normalizeAgent)
    : [];
  const store = createStore(agents);
  saveStore(store);
  return store;
}

function loadStoreFromDisk(): UniverseStore {
  const { storeFile } = resolvePaths();

  try {
    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    const parsed = universeStoreSchema.parse(raw);
    return {
      ...parsed,
      agents: parsed.agents.map(normalizeAgent),
    };
  } catch {
    archiveGeneratedFile(storeFile);
    return seedFromExamples();
  }
}

export function saveStore(store: UniverseStore): void {
  ensureDataDirectory();
  fs.writeFileSync(
    resolvePaths().storeFile,
    JSON.stringify(
      universeStoreSchema.parse({
        ...store,
        agents: store.agents.map(normalizeAgent),
      }),
      null,
      2,
    ),
  );
}

export function ensureSeedData(): UniverseStore {
  const { storeFile } = resolvePaths();
  ensureDataDirectory();

  if (!fs.existsSync(storeFile)) {
    return seedFromExamples();
  }

  try {
    const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
    if (isLegacyUniverseStore(raw)) {
      archiveGeneratedState();
      return seedFromExamples();
    }
  } catch {
    archiveGeneratedState();
    return seedFromExamples();
  }

  return loadStoreFromDisk();
}

export function loadStore(): UniverseStore {
  if (!fs.existsSync(resolvePaths().storeFile)) {
    return ensureSeedData();
  }

  return loadStoreFromDisk();
}

export function upsertAgent(agentInput: ConsciousnessAgent): UniverseStore {
  const raw = consciousnessAgentSchema.parse(agentInput);
  const existingStore = fs.existsSync(resolvePaths().storeFile) ? loadStoreFromDisk() : createStore([]);
  const existingAgent = existingStore.agents.find((agent) => agent.agentId === raw.agentId);
  const now = new Date().toISOString();
  const agent = normalizeAgent({
    ...raw,
    registeredAt: existingAgent?.registeredAt ?? raw.registeredAt ?? now,
  });
  const nextAgents = existingStore.agents.filter((existingAgentEntry) => existingAgentEntry.agentId !== agent.agentId);
  nextAgents.push(agent);
  const nextStore = createStore(nextAgents.sort((left, right) => left.displayName.localeCompare(right.displayName)));
  saveStore(nextStore);
  invalidateGraphCache();
  return nextStore;
}

export function registerAgent(agentInput: ConsciousnessAgent): { store: UniverseStore; isNew: boolean } {
  const raw = consciousnessAgentSchema.parse(agentInput);
  const existingStore = fs.existsSync(resolvePaths().storeFile) ? loadStoreFromDisk() : createStore([]);

  if (existingStore.agents.some((agent) => agent.agentId === raw.agentId)) {
    return { store: existingStore, isNew: false };
  }

  const now = new Date().toISOString();
  const agent = normalizeAgent({
    ...raw,
    registeredAt: raw.registeredAt ?? now,
  });
  const nextStore = createStore(
    [...existingStore.agents, agent].sort((left, right) => left.displayName.localeCompare(right.displayName)),
  );
  saveStore(nextStore);
  invalidateGraphCache();
  return { store: nextStore, isNew: true };
}

export function agentExists(agentId: string): boolean {
  if (!fs.existsSync(resolvePaths().storeFile)) {
    return false;
  }

  return loadStoreFromDisk().agents.some((agent) => agent.agentId === agentId);
}

export function removeAgent(agentId: string): UniverseStore {
  const store = fs.existsSync(resolvePaths().storeFile) ? loadStoreFromDisk() : createStore([]);
  const nextAgents = store.agents.filter((agent) => agent.agentId !== agentId);

  if (nextAgents.length === store.agents.length) {
    throw new Error(`Agent ${agentId} not found`);
  }

  const nextStore = createStore(nextAgents.sort((left, right) => left.displayName.localeCompare(right.displayName)));
  saveStore(nextStore);
  invalidateGraphCache();
  return nextStore;
}

let cachedGraph:
  | {
      hash: string;
      graph: ReturnType<typeof buildUniverseGraph>;
    }
  | null = null;

function computeGraphHash(agents: ConsciousnessAgent[], dialectStore: DialectsStore): string {
  const agentPart = agents
    .map((agent) => {
      const symbols = agent.symbols
        .map((symbol) => `${symbol.id}:${symbol.sequence}:${symbol.state}:${symbol.relations.join(",")}`)
        .join("|");
      const constellations = agent.constellations
        .map((constellation) => `${constellation.id}:${constellation.state}:${constellation.symbolIds.join(",")}`)
        .join("|");
      return `${agent.agentId}:${agent.updatedAt}:${symbols}:${constellations}`;
    })
    .join("#");
  const dialectPart = dialectStore.dialects
    .map((dialect) => `${dialect.pairId}:${dialect.families.map((family) => `${family.familyId}:${family.state}:${family.lastSeenAt}`).join("|")}`)
    .join("#");

  return `${agentPart}::${dialectPart}`;
}

export function getCachedGraph(
  agents: ConsciousnessAgent[],
  dialectStore: DialectsStore,
): ReturnType<typeof buildUniverseGraph> {
  const hash = computeGraphHash(agents, dialectStore);

  if (cachedGraph && cachedGraph.hash === hash) {
    return cachedGraph.graph;
  }

  const graph = buildUniverseGraph(agents, dialectStore);
  cachedGraph = { hash, graph };
  return graph;
}

export function invalidateGraphCache(): void {
  cachedGraph = null;
}

export function getStoreFilePath(): string {
  return resolvePaths().storeFile;
}

export function loadExchangesStore(): ExchangesStore {
  const { exchangesFile } = resolvePaths();

  if (!fs.existsSync(exchangesFile)) {
    return {
      updatedAt: new Date(0).toISOString(),
      events: [],
    };
  }

  try {
    return exchangesStoreSchema.parse(JSON.parse(fs.readFileSync(exchangesFile, "utf8")));
  } catch {
    archiveGeneratedFile(exchangesFile);
    return {
      updatedAt: new Date(0).toISOString(),
      events: [],
    };
  }
}

export function saveExchangesStore(store: ExchangesStore): void {
  ensureDataDirectory();
  fs.writeFileSync(resolvePaths().exchangesFile, JSON.stringify(exchangesStoreSchema.parse(store), null, 2));
}

export function appendExchangeEvent(event: ExchangeEvent): void {
  const store = loadExchangesStore();
  store.events.push(event);
  store.updatedAt = new Date().toISOString();
  saveExchangesStore(store);
}

export function loadDialectsStore(): DialectsStore {
  const { dialectsFile } = resolvePaths();

  if (!fs.existsSync(dialectsFile)) {
    return {
      updatedAt: new Date(0).toISOString(),
      dialects: [],
    };
  }

  try {
    return dialectsStoreSchema.parse(JSON.parse(fs.readFileSync(dialectsFile, "utf8")));
  } catch {
    archiveGeneratedFile(dialectsFile);
    return {
      updatedAt: new Date(0).toISOString(),
      dialects: [],
    };
  }
}

export function saveDialectsStore(store: DialectsStore): void {
  ensureDataDirectory();
  fs.writeFileSync(resolvePaths().dialectsFile, JSON.stringify(dialectsStoreSchema.parse(store), null, 2));
}

export function upsertPairDialect(pairDialect: PairDialect): DialectsStore {
  const store = loadDialectsStore();
  const nextDialects = store.dialects.filter((dialect) => dialect.pairId !== pairDialect.pairId);
  nextDialects.push(pairDialect);
  const nextStore = {
    updatedAt: new Date().toISOString(),
    dialects: nextDialects.sort((left, right) => left.pairId.localeCompare(right.pairId)),
  };
  saveDialectsStore(nextStore);
  invalidateGraphCache();
  return nextStore;
}

export function loadLineage(): LineageEntry[] {
  const { lineageFile } = resolvePaths();

  if (!fs.existsSync(lineageFile)) {
    return [];
  }

  try {
    const raw = JSON.parse(fs.readFileSync(lineageFile, "utf8")) as unknown[];
    return raw.map((entry) => lineageEntrySchema.parse(entry));
  } catch {
    archiveGeneratedFile(lineageFile);
    return [];
  }
}

export function appendLineage(entry: LineageEntry): void {
  ensureDataDirectory();
  const lineage = loadLineage();
  lineage.push(lineageEntrySchema.parse(entry));
  fs.writeFileSync(resolvePaths().lineageFile, JSON.stringify(lineage, null, 2));
}

export function loadLineageForAgent(agentId: string): LineageEntry[] {
  return loadLineage().filter((entry) => entry.agentId === agentId);
}
