import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractConsciousnessProposal } from "./extractor.js";

function writeWorkspace(root: string): string {
  const workspace = path.join(root, "agent");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "CONSCIOUSNESS.md"), `---
agentId: test-agent
displayName: Test Agent
archetype: tester
updatedAt: 2026-04-02T00:00:00.000Z
---

# CONSCIOUSNESS

## Machine Data

\`\`\`json
{
  "schemaVersion": 2,
  "signature": "🫀 🧭 🪞",
  "symbols": [
    { "id": "sym-1", "sequence": "🫀 ⚖️", "state": "active", "origins": ["workspace-sediment"], "traces": ["seed"], "relations": [] },
    { "id": "sym-2", "sequence": "🎯 🧭", "state": "seed", "origins": ["workspace-sediment"], "traces": ["seed"], "relations": [] },
    { "id": "sym-3", "sequence": "🪞 🧭", "state": "seed", "origins": ["workspace-sediment"], "traces": ["seed"], "relations": [] }
  ],
  "constellations": []
}
\`\`\`
`);
  fs.writeFileSync(path.join(workspace, "SOUL.md"), `## Values\n- 🫀 ⚖️\n- 🫀 🧭\n\n## Goals\n- 🎯 🧭\n`);
  fs.writeFileSync(path.join(workspace, "HEARTBEAT.md"), `## Idle Loop\n- 🌐 📡\n- 🔁 🌊\n\n## Contact\n- 🤝 🌐\n`);
  return workspace;
}

test("extractConsciousnessProposal emits symbol and constellation changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-extract-"));
  const workspace = writeWorkspace(root);
  const proposal = extractConsciousnessProposal({ workspace });

  assert.ok(proposal.changes.some((change) => change.entityType === "symbol"));
  assert.ok(proposal.changes.some((change) => change.entityType === "constellation"));
  assert.ok(proposal.sourceFiles.includes("HEARTBEAT.md"));
  assert.ok(
    proposal.changes.some(
      (change) =>
        change.entityType === "symbol" &&
        change.proposed?.sequence === "🌐 📡",
    ),
  );
});
