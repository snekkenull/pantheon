import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("generate-exchange-demo bootstraps symbolic agents and produces exchanges", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-demo-sim-"));
  const tsxPath = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const scriptPath = path.join(process.cwd(), "scripts", "generate-exchange-demo.ts");
  const result = spawnSync(tsxPath, [scriptPath], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      ...process.env,
      PANTHEON_SIM_PROTOCOL: "fake",
      PANTHEON_SIM_PULSE_COUNT: "3",
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const universe = JSON.parse(fs.readFileSync(path.join(workspace, "data", "universe.json"), "utf8")) as {
    agents: Array<{ agentId: string; symbols: Array<unknown> }>;
  };
  const exchanges = JSON.parse(fs.readFileSync(path.join(workspace, "data", "exchanges.json"), "utf8")) as {
    events: Array<{ status: string }>;
  };
  const dialects = JSON.parse(fs.readFileSync(path.join(workspace, "data", "dialects.json"), "utf8")) as {
    dialects: Array<{ families: Array<{ state: string }> }>;
  };

  assert.equal(universe.agents.length, 4);
  assert.ok(universe.agents.every((agent) => agent.symbols.length >= 3));
  assert.ok(exchanges.events.length > 0, "demo should generate exchange events");
  assert.ok(dialects.dialects.some((dialect) => dialect.families.length > 0), "demo should generate dialect families");
  assert.ok(
    fs.existsSync(
      path.join(
        workspace,
        ".pantheon",
        "demo-workspaces",
        "signal-cartographer",
        "HEARTBEAT.md",
      ),
    ),
    "demo should seed HEARTBEAT.md into virtual workspaces",
  );
});
