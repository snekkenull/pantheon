import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyProposal,
  reviewProposal,
  writeProposalFile,
} from "./workflow.js";
import { extractConsciousnessProposal } from "./extractor.js";
import { parseConsciousnessMarkdown } from "../server/consciousness.js";
import { resolveWorkspace } from "./workspace.js";

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

test("applyProposal writes reviewed symbolic changes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-workflow-"));
  const workspace = writeWorkspace(root);
  const previousCwd = process.cwd();
  const context = resolveWorkspace(workspace);

  try {
    process.chdir(root);
    const proposal = extractConsciousnessProposal({ workspace });
    const proposalPath = writeProposalFile(proposal, context.proposalsDirectory);
    const reviewResult = reviewProposal({
      workspace,
      proposalPath,
    });

    const result = await applyProposal({
      workspace,
      proposalPath,
      reviewPath: reviewResult.reviewPath,
      fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 202 }),
    });

    assert.equal(result.noOp, false);
    const updated = parseConsciousnessMarkdown(fs.readFileSync(context.consciousnessFile, "utf8"), context.consciousnessFile);
    assert.ok(updated.symbols.some((symbol) => symbol.sequence === "🫀 🧭"));
    assert.ok(updated.symbols.some((symbol) => symbol.sequence === "🌐 📡"));
  } finally {
    process.chdir(previousCwd);
  }
});
