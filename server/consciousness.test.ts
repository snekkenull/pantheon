import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildUniverseGraph, parseConsciousnessMarkdown } from "./consciousness.js";
import { getCachedGraph, invalidateGraphCache, loadAgentsFromDirectory } from "./store.js";
import type { DialectsStore } from "./types.js";

const exampleDirectory = path.join(process.cwd(), "examples", "agents");

test("parseConsciousnessMarkdown extracts schemaVersion 2 machine data", () => {
  const atlasPath = path.join(exampleDirectory, "atlas.CONSCIOUSNESS.md");
  const atlas = parseConsciousnessMarkdown(fs.readFileSync(atlasPath, "utf8"), atlasPath);

  assert.equal(atlas.schemaVersion, 2);
  assert.equal(atlas.symbols.length, 4);
  assert.equal(atlas.constellations.length, 1);
  assert.equal(atlas.signature, "🧭 🫀 🪞");
});

test("buildUniverseGraph creates agent and family nodes", () => {
  const agents = loadAgentsFromDirectory(exampleDirectory);
  const dialectStore: DialectsStore = {
    updatedAt: new Date().toISOString(),
    dialects: [{
      pairId: "atlas::loom",
      agentIds: ["atlas", "loom"],
      families: [{
        familyId: "family-1",
        anchorSequence: "🎯 🧭",
        variantSequences: [],
        state: "ritual",
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenAt: "2026-04-02T00:00:00.000Z",
        exchangeIds: ["evt-1", "evt-2", "evt-3"],
        participantAgentIds: ["atlas", "loom"],
        carrierAgentIds: [],
        originPairId: "atlas::loom",
      }],
      lastExchangeAt: "2026-04-02T00:00:00.000Z",
    }],
  };

  const graph = buildUniverseGraph(agents, dialectStore);

  assert.ok(graph.nodes.some((node) => node.kind === "agent" && node.agentId === "atlas"));
  assert.ok(graph.nodes.some((node) => node.kind === "family" && node.familyId === "family-1"));
  assert.ok(graph.links.some((link) => link.kind === "ritualizes"));
});

test("getCachedGraph returns identical graph for unchanged inputs", () => {
  const agents = loadAgentsFromDirectory(exampleDirectory);
  const dialectStore: DialectsStore = { updatedAt: new Date().toISOString(), dialects: [] };
  invalidateGraphCache();
  const first = getCachedGraph(agents, dialectStore);
  const second = getCachedGraph(agents, dialectStore);
  assert.deepEqual(first, second);
});
