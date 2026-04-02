import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseTurns, registerExchangeGenerator, runExchangePulse } from "./exchange-loop.js";
import { loadDialectsStore, saveStore } from "./store.js";
import type { ConsciousnessAgent, ExchangeTurn } from "./types.js";

function buildAgent(agentId: string, displayName: string, sequences: string[]): ConsciousnessAgent {
  return {
    schemaVersion: 2,
    agentId,
    displayName,
    archetype: "test",
    updatedAt: "2026-04-02T00:00:00.000Z",
    signature: sequences.slice(0, 3).join(" "),
    symbols: sequences.map((sequence, index) => ({
      id: `${agentId}-${index + 1}`,
      sequence,
      state: "active",
      origins: ["workspace-sediment"],
      traces: ["seed:test"],
      relations: [],
    })),
    constellations: [],
  };
}

function queueGenerator(plan: Record<string, string[]>): (left: ConsciousnessAgent, right: ConsciousnessAgent) => Promise<{ model: string; turns: ExchangeTurn[] }> {
  return async (left, right) => {
    const pairId = [left.agentId, right.agentId].sort().join("::");
    const queue = plan[pairId];
    const next = queue?.shift();

    if (!next) {
      throw new Error(`No planned exchange for ${pairId}`);
    }

    return {
      model: "test-protocol",
      turns: parseTurns(next, left.agentId, right.agentId),
    };
  };
}

test("parseTurns rejects non-emoji output", () => {
  assert.throws(
    () => parseTurns("emoji words here", "atlas", "loom"),
    /Expected 4 emoji lines|Expected emoji-only content/,
  );
});

test("runExchangePulse promotes ritual families after repeated dual-agent reuse", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-exchange-ritual-"));
  const previousCwd = process.cwd();
  const previousMaxPairs = process.env.PANTHEON_EXCHANGE_MAX_PAIRS;

  try {
    process.chdir(tmpDir);
    process.env.PANTHEON_EXCHANGE_MAX_PAIRS = "1";
    fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
    saveStore({
      updatedAt: new Date().toISOString(),
      agents: [
        buildAgent("atlas", "Atlas", ["🫀 ⚖️", "🎯 🧭", "🪞 🧭"]),
        buildAgent("loom", "Loom", ["🫀 ⚖️", "🎯 🧭", "🌊 🧭"]),
      ],
    });

    registerExchangeGenerator(queueGenerator({
      "atlas::loom": [
        "🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️",
        "🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️",
        "🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️",
      ],
    }));

    await runExchangePulse({ now: new Date("2026-04-02T10:00:00.000Z") });
    await runExchangePulse({ now: new Date("2026-04-02T11:00:00.000Z") });
    await runExchangePulse({ now: new Date("2026-04-02T12:00:00.000Z") });

    const dialect = loadDialectsStore().dialects.find((entry) => entry.pairId === "atlas::loom");
    assert.ok(dialect);
    assert.equal(dialect?.families[0]?.state, "ritual");
  } finally {
    registerExchangeGenerator(null);
    process.chdir(previousCwd);
    if (previousMaxPairs === undefined) {
      delete process.env.PANTHEON_EXCHANGE_MAX_PAIRS;
    } else {
      process.env.PANTHEON_EXCHANGE_MAX_PAIRS = previousMaxPairs;
    }
  }
});

test("runExchangePulse marks mirrored reuse in the next completed exchange", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-exchange-mirror-"));
  const previousCwd = process.cwd();
  const previousMaxPairs = process.env.PANTHEON_EXCHANGE_MAX_PAIRS;

  try {
    process.chdir(tmpDir);
    process.env.PANTHEON_EXCHANGE_MAX_PAIRS = "1";
    fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
    saveStore({
      updatedAt: new Date().toISOString(),
      agents: [
        buildAgent("atlas", "Atlas", ["🫀 ⚖️", "🎯 🧭", "🪞 🧭"]),
        buildAgent("loom", "Loom", ["🫀 ⚖️", "🎯 🧭", "🌊 🧭"]),
      ],
    });

    registerExchangeGenerator(queueGenerator({
      "atlas::loom": [
        "🫀 ⚖️\n🌊 🧭\n🫀 ⚖️\n🌊 🧭",
        "🌊 🧭\n🫀 ⚖️\n🌊 🧭\n🫀 ⚖️",
      ],
    }));

    await runExchangePulse({ now: new Date("2026-04-02T10:00:00.000Z") });
    const events = await runExchangePulse({ now: new Date("2026-04-02T11:00:00.000Z") });

    const loomReuse = events[0].relations.find((relation) => relation.sequence === "🫀" && relation.speakerId === "loom");
    assert.equal(loomReuse?.kind, "mirrored");
  } finally {
    registerExchangeGenerator(null);
    process.chdir(previousCwd);
    if (previousMaxPairs === undefined) {
      delete process.env.PANTHEON_EXCHANGE_MAX_PAIRS;
    } else {
      process.env.PANTHEON_EXCHANGE_MAX_PAIRS = previousMaxPairs;
    }
  }
});

test("runExchangePulse marks dormant families and reactivates them on later reuse", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-exchange-reactivate-"));
  const previousCwd = process.cwd();
  const previousMaxPairs = process.env.PANTHEON_EXCHANGE_MAX_PAIRS;

  try {
    process.chdir(tmpDir);
    process.env.PANTHEON_EXCHANGE_MAX_PAIRS = "1";
    fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
    saveStore({
      updatedAt: new Date().toISOString(),
      agents: [
        buildAgent("atlas", "Atlas", ["🫀 ⚖️", "🎯 🧭", "🪞 🧭"]),
        buildAgent("loom", "Loom", ["🫀 ⚖️", "🎯 🧭", "🌊 🧭"]),
      ],
    });

    registerExchangeGenerator(queueGenerator({
      "atlas::loom": [
        "🫀 ⚖️\n🌊 🧭\n🫀 ⚖️\n🌊 🧭",
        "🎯 🧭\n🌊 🧭\n🎯 🧭\n🌊 🧭",
        "🎯 🧭\n🌊 🧭\n🎯 🧭\n🌊 🧭",
        "🎯 🧭\n🌊 🧭\n🎯 🧭\n🌊 🧭",
        "🫀 ⚖️\n🌊 🧭\n🫀 ⚖️\n🌊 🧭",
      ],
    }));

    await runExchangePulse({ now: new Date("2026-04-02T10:00:00.000Z") });
    await runExchangePulse({ now: new Date("2026-04-02T11:00:00.000Z") });
    await runExchangePulse({ now: new Date("2026-04-02T12:00:00.000Z") });
    await runExchangePulse({ now: new Date("2026-04-02T13:00:00.000Z") });

    const dormantDialect = loadDialectsStore().dialects.find((entry) => entry.pairId === "atlas::loom");
    const dormantFamily = dormantDialect?.families.find((family) => family.anchorSequence === "🫀");
    assert.equal(dormantFamily?.state, "dormant");

    const events = await runExchangePulse({ now: new Date("2026-04-02T14:00:00.000Z") });
    assert.ok(events[0].relations.some((relation) => relation.kind === "reactivated" && relation.sequence === "🫀"));

    const reactivatedDialect = loadDialectsStore().dialects.find((entry) => entry.pairId === "atlas::loom");
    const reactivatedFamily = reactivatedDialect?.families.find((family) => family.anchorSequence === "🫀");
    assert.equal(reactivatedFamily?.state, "active");
  } finally {
    registerExchangeGenerator(null);
    process.chdir(previousCwd);
    if (previousMaxPairs === undefined) {
      delete process.env.PANTHEON_EXCHANGE_MAX_PAIRS;
    } else {
      process.env.PANTHEON_EXCHANGE_MAX_PAIRS = previousMaxPairs;
    }
  }
});

test("runExchangePulse confirms bridge propagation and respects bucket order", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-exchange-bridge-"));
  const previousCwd = process.cwd();
  const previousMaxPairs = process.env.PANTHEON_EXCHANGE_MAX_PAIRS;

  try {
    process.chdir(tmpDir);
    fs.mkdirSync(path.join(tmpDir, "data"), { recursive: true });
    saveStore({
      updatedAt: new Date().toISOString(),
      agents: [
        buildAgent("atlas", "Atlas", ["🫀 ⚖️", "🎯 🧭", "🪞 🧭"]),
        buildAgent("loom", "Loom", ["🫀 ⚖️", "🎯 🧭", "🌊 🧭"]),
      ],
    });

    process.env.PANTHEON_EXCHANGE_MAX_PAIRS = "1";
    registerExchangeGenerator(queueGenerator({
      "atlas::loom": [
        "🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️",
        "🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️",
        "🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️",
      ],
    }));

    await runExchangePulse({ now: new Date("2026-04-02T10:00:00.000Z") });
    await runExchangePulse({ now: new Date("2026-04-02T11:00:00.000Z") });
    await runExchangePulse({ now: new Date("2026-04-02T12:00:00.000Z") });

    saveStore({
      updatedAt: new Date().toISOString(),
      agents: [
        buildAgent("atlas", "Atlas", ["🫀 ⚖️", "🎯 🧭", "🪞 🧭"]),
        buildAgent("loom", "Loom", ["🫀 ⚖️", "🎯 🧭", "🌊 🧭"]),
        buildAgent("reef", "Reef", ["🫀 ⚖️", "🌊 🧭", "🪸 🫧"]),
      ],
    });

    process.env.PANTHEON_EXCHANGE_MAX_PAIRS = "3";
    registerExchangeGenerator(queueGenerator({
      "atlas::loom": [
        "🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️",
        "🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️\n🫀 ⚖️",
      ],
      "atlas::reef": [
        "🫀 ⚖️\n🌊 🧭\n🫀 ⚖️\n🌊 🧭",
        "🎯 🧭\n🫀 ⚖️\n🎯 🧭\n🫀 ⚖️",
      ],
      "loom::reef": [
        "🌊 🧭\n🌊 🧭\n🌊 🧭\n🌊 🧭",
        "🌊 🧭\n🌊 🧭\n🌊 🧭\n🌊 🧭",
      ],
    }));

    const pulseFour = await runExchangePulse({ now: new Date("2026-04-02T13:00:00.000Z") });
    assert.equal(pulseFour[0]?.pairId, "atlas::loom");
    assert.equal(pulseFour[1]?.pairId, "atlas::reef");
    const carriedEvent = pulseFour.find((event) => event.pairId === "atlas::reef");
    assert.ok(carriedEvent?.relations.some((relation) => relation.kind === "carried" && relation.sequence === "🫀"));

    const pulseFive = await runExchangePulse({ now: new Date("2026-04-02T14:00:00.000Z") });
    const confirmedEvent = pulseFive.find((event) => event.pairId === "atlas::reef");
    assert.ok(confirmedEvent?.relations.some((relation) => relation.sequence === "🫀"));

    const dialect = loadDialectsStore().dialects.find((entry) => entry.pairId === "atlas::reef");
    const carriedFamily = dialect?.families.find((family) => family.anchorSequence === "🫀");
    assert.equal(carriedFamily?.state, "bridge");
  } finally {
    registerExchangeGenerator(null);
    process.chdir(previousCwd);
    if (previousMaxPairs === undefined) {
      delete process.env.PANTHEON_EXCHANGE_MAX_PAIRS;
    } else {
      process.env.PANTHEON_EXCHANGE_MAX_PAIRS = previousMaxPairs;
    }
  }
});
