import test from "node:test";
import assert from "node:assert/strict";

import { buildUniverseMorphology } from "./flows.js";
import type { DialectsStore, ExchangeEvent } from "./types.js";

test("buildUniverseMorphology aggregates timelines, buckets, and bridges", () => {
  const dialectStore: DialectsStore = {
    updatedAt: "2026-04-02T00:00:00.000Z",
    dialects: [{
      pairId: "atlas::loom",
      agentIds: ["atlas", "loom"],
      families: [{
        familyId: "family-1",
        anchorSequence: "🫀 ⚖️",
        variantSequences: ["🫀 🧭"],
        state: "bridge",
        firstSeenAt: "2026-04-01T00:00:00.000Z",
        lastSeenAt: "2026-04-02T00:00:00.000Z",
        exchangeIds: ["evt-1", "evt-2"],
        participantAgentIds: ["atlas", "loom"],
        carrierAgentIds: ["atlas"],
        originPairId: "atlas::reef",
      }],
      lastExchangeAt: "2026-04-02T00:00:00.000Z",
    }],
  };

  const events: ExchangeEvent[] = [{
    exchangeId: "evt-1",
    createdAt: "2026-04-01T00:00:00.000Z",
    pairId: "atlas::loom",
    initiatorId: "atlas",
    targetId: "loom",
    model: "test",
    status: "completed",
    turns: [],
    relations: [{
      relationId: "rel-1",
      kind: "carried",
      familyId: "family-1",
      sequence: "🫀 ⚖️",
      speakerId: "atlas",
      pairId: "atlas::loom",
      createdAt: "2026-04-01T00:00:00.000Z",
      derivedFromFamilyId: "family-1",
      carriedByAgentId: "atlas",
    }],
  }, {
    exchangeId: "evt-2",
    createdAt: "2026-04-02T00:00:00.000Z",
    pairId: "atlas::loom",
    initiatorId: "atlas",
    targetId: "loom",
    model: "test",
    status: "completed",
    turns: [],
    relations: [{
      relationId: "rel-2",
      kind: "mirrored",
      familyId: "family-1",
      sequence: "🫀 ⚖️",
      speakerId: "loom",
      pairId: "atlas::loom",
      createdAt: "2026-04-02T00:00:00.000Z",
    }],
  }];

  const morphology = buildUniverseMorphology({
    dialectStore,
    events,
    now: new Date("2026-04-02T12:00:00.000Z"),
  });

  assert.equal(morphology.pairs.length, 1);
  assert.equal(morphology.pairs[0].bridgeCount, 1);
  assert.equal(morphology.pairs[0].nextBucket, "resonance");
  assert.equal(morphology.families.length, 1);
  assert.equal(morphology.families[0].propagationDepth, 1);
  assert.equal(morphology.families[0].variantSequences.length, 1);
  assert.equal(morphology.families[0].timeline.length, 2);
  assert.equal(morphology.bridges.length, 1);
  assert.equal(morphology.bridges[0].status, "confirmed");
  assert.equal(morphology.bridges[0].anchorSequence, "🫀 ⚖️");
});
