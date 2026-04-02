import cors from "cors";
import express from "express";

import { buildRelatedAgents, evaluateAgents } from "./consciousness.js";
import { buildUniverseMorphology } from "./flows.js";
import { getAutomaticPulseState, getPulseIntervalMs, hasExchangeGenerator, listAgentExchanges, runExchangePulse } from "./exchange-loop.js";
import {
  agentExists,
  getCachedGraph,
  loadDialectsStore,
  loadExchangesStore,
  loadLineage,
  loadLineageForAgent,
  loadStore,
  registerAgent,
  removeAgent,
  upsertAgent,
} from "./store.js";
import { consciousnessAgentSchema } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/universe/state", (_request, response) => {
  const store = loadStore();
  const evaluatedAt = new Date();
  const agents = evaluateAgents(store.agents);
  const dialectStore = loadDialectsStore();
  const graph = getCachedGraph(agents, dialectStore);
  const exchangeStore = loadExchangesStore();
  const morphology = buildUniverseMorphology({
    dialectStore,
    events: exchangeStore.events,
    now: evaluatedAt,
  });
  const ritualFamilyCount = dialectStore.dialects.reduce(
    (count, dialect) => count + dialect.families.filter((family) => family.state === "ritual" || family.state === "bridge").length,
    0,
  );
  const bridgeFamilyCount = dialectStore.dialects.reduce(
    (count, dialect) => count + dialect.families.filter((family) => family.state === "bridge").length,
    0,
  );
  const dormantFamilyCount = dialectStore.dialects.reduce(
    (count, dialect) => count + dialect.families.filter((family) => family.state === "dormant").length,
    0,
  );
  const reactivationCountWindow = morphology.events.reduce(
    (count, event) => count + event.relations.filter((relation) => relation.kind === "reactivated").length,
    0,
  );

  response.json({
    evaluatedAt: evaluatedAt.toISOString(),
    updatedAt: store.updatedAt,
    agentCount: agents.length,
    symbolCount: agents.reduce((count, agent) => count + agent.symbols.length, 0),
    dialectCount: dialectStore.dialects.length,
    ritualFamilyCount,
    bridgeFamilyCount,
    dormantFamilyCount,
    reactivationCountWindow,
    recentExchangeCount: exchangeStore.events.filter((event) => event.status === "completed").length,
    agents,
    graph,
  });
});

app.get("/api/universe/morphology", (_request, response) => {
  const evaluatedAt = new Date();
  response.json(buildUniverseMorphology({
    dialectStore: loadDialectsStore(),
    events: loadExchangesStore().events,
    now: evaluatedAt,
  }));
});

app.get("/api/agents/:agentId", (request, response) => {
  const store = loadStore();
  const agent = evaluateAgents(store.agents).find((entry) => entry.agentId === request.params.agentId);

  if (!agent) {
    response.status(404).json({ error: "Agent not found" });
    return;
  }

  response.json({
    evaluatedAt: new Date().toISOString(),
    ...agent,
  });
});

app.get("/api/agents/:agentId/exchanges", (request, response) => {
  response.json(listAgentExchanges(request.params.agentId));
});

app.get("/api/agents/:agentId/related", (request, response) => {
  try {
    const store = loadStore();
    response.json({
      evaluatedAt: new Date().toISOString(),
      ...buildRelatedAgents(request.params.agentId, evaluateAgents(store.agents)),
    });
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/agents", (request, response) => {
  try {
    const agent = consciousnessAgentSchema.parse(request.body);
    const result = registerAgent(agent);

    if (!result.isNew) {
      response.status(409).json({
        error: "Agent already exists",
        agentId: agent.agentId,
      });
      return;
    }

    response.status(201).json({
      ok: true,
      agentId: agent.agentId,
      registeredAt: result.store.agents.find((entry) => entry.agentId === agent.agentId)?.registeredAt,
      updatedAt: result.store.updatedAt,
      agentCount: result.store.agents.length,
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid consciousness payload",
    });
  }
});

app.put("/api/agents/:agentId/consciousness", (request, response) => {
  try {
    const agent = consciousnessAgentSchema.parse(request.body);

    if (agent.agentId !== request.params.agentId) {
      response.status(400).json({
        error: "Path agentId must match request body agentId",
      });
      return;
    }

    if (!agentExists(agent.agentId)) {
      response.status(404).json({
        error: "Agent not found. Use POST /api/agents to register a new agent.",
      });
      return;
    }

    const store = upsertAgent(agent);
    response.status(202).json({
      ok: true,
      updatedAt: store.updatedAt,
      agentCount: store.agents.length,
    });
  } catch (error) {
    response.status(400).json({
      error: error instanceof Error ? error.message : "Invalid consciousness payload",
    });
  }
});

app.delete("/api/agents/:agentId", (request, response) => {
  try {
    const store = removeAgent(request.params.agentId);
    response.json({
      ok: true,
      updatedAt: store.updatedAt,
      agentCount: store.agents.length,
    });
  } catch (error) {
    response.status(404).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agents/:agentId/lineage", (request, response) => {
  const agentId = request.params.agentId;
  let lineage = loadLineageForAgent(agentId);
  const from = request.query.from as string | undefined;
  const to = request.query.to as string | undefined;

  if (from) {
    const fromTime = new Date(from).getTime();
    lineage = lineage.filter((entry) => new Date(entry.timestamp).getTime() >= fromTime);
  }

  if (to) {
    const toTime = new Date(to).getTime();
    lineage = lineage.filter((entry) => new Date(entry.timestamp).getTime() <= toTime);
  }

  response.json({ agentId, lineage });
});

app.post("/api/universe/exchange-pulse", async (_request, response) => {
  if (!hasExchangeGenerator()) {
    response.status(503).json({
      error: "No exchange protocol adapter is registered",
    });
    return;
  }

  try {
    const events = await runExchangePulse();
    response.json({ ok: true, processed: events.length, events });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Exchange pulse failed",
    });
  }
});

app.post("/api/universe/autonomy-pulse", async (_request, response) => {
  if (!hasExchangeGenerator()) {
    response.status(503).json({
      error: "No exchange protocol adapter is registered",
    });
    return;
  }

  try {
    const events = await runExchangePulse();
    const morphology = buildUniverseMorphology({
      dialectStore: loadDialectsStore(),
      events: loadExchangesStore().events,
      now: new Date(),
    });
    response.json({ ok: true, processed: events.length, events, morphology });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Autonomy pulse failed",
    });
  }
});

app.listen(port, () => {
  console.log(`Pantheon API listening on http://localhost:${port}`);
});

const pulseState = getAutomaticPulseState();

if (pulseState.shouldStart) {
  setInterval(() => {
    void runExchangePulse().catch((error) => {
      console.error("Exchange pulse failed:", error instanceof Error ? error.message : error);
    });
  }, getPulseIntervalMs());
} else if (pulseState.reason) {
  console.log(pulseState.reason);
}
