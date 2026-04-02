import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`${name} is required for remote demo smoke tests`);
  }

  return value.trim();
}

async function main(): Promise<void> {
  requireEnv("PANTHEON_SIM_ENDPOINT");
  requireEnv("PANTHEON_SIM_BEARER_TOKEN");

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-remote-demo-"));
  const tsxPath = path.join(repoRoot, "node_modules", ".bin", "tsx");
  const demoScriptPath = path.join(repoRoot, "scripts", "generate-exchange-demo.ts");
  const result = spawnSync(tsxPath, [demoScriptPath], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      PANTHEON_SIM_PROTOCOL: "remote",
      PANTHEON_SIM_RESET_DATA: process.env.PANTHEON_SIM_RESET_DATA ?? "1",
      PANTHEON_SIM_PULSE_COUNT: process.env.PANTHEON_SIM_PULSE_COUNT ?? "3",
      PANTHEON_SIM_MIN_AFFINITY: process.env.PANTHEON_SIM_MIN_AFFINITY ?? "0.15",
    },
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Remote demo smoke failed");
  }

  const universe = JSON.parse(fs.readFileSync(path.join(workspace, "data", "universe.json"), "utf8")) as {
    agents: Array<{ agentId: string; symbols: Array<unknown> }>;
  };
  const exchanges = JSON.parse(fs.readFileSync(path.join(workspace, "data", "exchanges.json"), "utf8")) as {
    events: Array<{ status: string; model: string }>;
  };
  const dialects = JSON.parse(fs.readFileSync(path.join(workspace, "data", "dialects.json"), "utf8")) as {
    dialects: Array<{ families: Array<{ state: string }> }>;
  };

  assert.equal(universe.agents.length, 4, "remote demo should bootstrap four virtual agents");
  assert.ok(
    universe.agents.every((agent) => agent.symbols.length > 3),
    "remote demo should expand each agent beyond its seed symbol set",
  );
  assert.ok(exchanges.events.length > 0, "remote demo should generate exchange events");
  assert.ok(
    exchanges.events.some((event) => event.status === "completed"),
    "remote demo should include completed exchanges",
  );
  assert.ok(
    exchanges.events.every((event) => event.model.length > 0),
    "remote demo should record the model used for each exchange attempt",
  );
  assert.ok(
    dialects.dialects.some((dialect) =>
      dialect.families.some((family) => family.state === "ritual" || family.state === "bridge"),
    ),
    "remote demo should ritualize at least one dialect family",
  );

  const demoWorkspaceRoot = path.join(workspace, ".pantheon", "demo-workspaces");
  assert.ok(fs.existsSync(path.join(demoWorkspaceRoot, "signal-cartographer", "skills", "orientation-weave.md")));
  assert.ok(
    fs.existsSync(
      path.join(
        demoWorkspaceRoot,
        "signal-cartographer",
        ".pantheon",
        "consciousness",
        "history.jsonl",
      ),
    ),
    "remote demo should record autonomous history",
  );
  assert.ok(
    !fs.existsSync(
      path.join(
        demoWorkspaceRoot,
        "signal-cartographer",
        ".pantheon",
        "consciousness",
        "reviews",
      ),
    ),
    "remote demo should not produce review artifacts",
  );

  process.chdir(workspace);
  const { buildUniverseMorphology } = await import(pathToFileURL(path.join(repoRoot, "server", "flows.ts")).href);
  const { loadDialectsStore, loadExchangesStore, loadLineage, loadStore } = await import(
    pathToFileURL(path.join(repoRoot, "server", "store.ts")).href
  );
  const store = loadStore();
  const exchangeStore = loadExchangesStore();
  const dialectStore = loadDialectsStore();
  const lineage = loadLineage();
  const morphology = buildUniverseMorphology({
    dialectStore,
    events: loadExchangesStore().events,
    now: new Date(),
  });

  assert.ok(morphology.pairs.length > 0, "remote demo should produce morphology pairs");
  assert.ok(morphology.families.length > 0, "remote demo should produce morphology families");
  assert.ok(morphology.events.length > 0, "remote demo should produce morphology events");
  assert.ok(
    lineage.length > 0,
    "remote demo should produce observable mutation activity",
  );
  assert.equal(store.agents.length, 4, "remote demo should persist four published agents");
  assert.ok(
    exchangeStore.events.some((event: { status: string }) => event.status === "completed"),
    "remote demo should persist completed exchanges",
  );
  assert.ok(dialectStore.dialects.length > 0, "remote demo should persist pair dialects");

  console.log(`Remote demo smoke passed in ${workspace}`);
  console.log(result.stdout.trim());
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
