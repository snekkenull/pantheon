import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { extractConsciousnessProposal } from "../consciousness/extractor.js";
import { applyAutonomousProposal, writeProposalFile } from "../consciousness/workflow.js";
import { buildMachineData, parseConsciousnessMarkdown, stringifyMachineData } from "./consciousness.js";
import type { ExchangeGenerator } from "./exchange-loop.js";
import { agentExists, loadStore, registerAgent, upsertAgent } from "./store.js";
import type { ConsciousnessAgent, ExchangeTurn } from "./types.js";

const PLATFORM_BASE_URL = "http://pantheon.local";

type VirtualSourceSeed = {
  relativePath: string;
  date?: string;
  sections: Array<{
    heading: string;
    bullets: string[];
  }>;
};

export type VirtualAgentSeed = {
  agentId: string;
  displayName: string;
  archetype: string;
  updatedAt: string;
  signature: string;
  baseSequences: string[];
  sources: VirtualSourceSeed[];
};

export type BootstrappedVirtualAgent = {
  agentId: string;
  workspaceDir: string;
  sourceFileCount: number;
  acceptedChangeCount: number;
  symbolCountBefore: number;
  symbolCountAfter: number;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

async function readJsonRequestBody(requestInit?: RequestInit): Promise<unknown> {
  const body = requestInit?.body;

  if (typeof body !== "string") {
    throw new Error("Expected JSON string request body");
  }

  return JSON.parse(body);
}

export function createLocalPlatformFetch(): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();

    if (url.pathname === "/api/agents" && method === "POST") {
      const agent = (await readJsonRequestBody(init)) as ConsciousnessAgent;
      const result = registerAgent(agent);

      if (!result.isNew) {
        return jsonResponse(409, {
          error: "Agent already exists",
          agentId: agent.agentId,
        });
      }

      return jsonResponse(201, {
        ok: true,
        agentId: agent.agentId,
      });
    }

    const updateMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/consciousness$/);

    if (updateMatch && method === "PUT") {
      const agentId = decodeURIComponent(updateMatch[1]);
      const agent = (await readJsonRequestBody(init)) as ConsciousnessAgent;

      if (agent.agentId !== agentId) {
        return jsonResponse(400, {
          error: "Path agentId must match request body agentId",
        });
      }

      if (!agentExists(agentId)) {
        return jsonResponse(404, {
          error: "Agent not found. Use POST /api/agents to register a new agent.",
        });
      }

      const store = upsertAgent(agent);
      return jsonResponse(202, {
        ok: true,
        updatedAt: store.updatedAt,
      });
    }

    return jsonResponse(404, {
      error: `Unsupported demo route: ${method} ${url.pathname}`,
    });
  };
}

function buildSourceMarkdown(source: VirtualSourceSeed): string {
  const frontMatter = source.date
    ? `---\ndate: ${source.date}\n---\n\n`
    : "";
  const sections = source.sections
    .map((section) => {
      const bullets = section.bullets.map((bullet) => `- ${bullet}`).join("\n");
      return `## ${section.heading}\n${bullets}`;
    })
    .join("\n\n");

  return `${frontMatter}${sections}\n`;
}

function writeFile(targetPath: string, content: string): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function buildBaseAgent(seed: VirtualAgentSeed, workspaceName: string): ConsciousnessAgent {
  const symbols = seed.baseSequences.map((sequence, index) => ({
    id: `${seed.agentId}-base-${index + 1}`,
    sequence,
    state: "active" as const,
    origins: ["workspace-sediment" as const],
    traces: ["seed:base"],
    relations: [],
  }));

  return {
    schemaVersion: 2,
    agentId: seed.agentId,
    displayName: seed.displayName,
    archetype: seed.archetype,
    updatedAt: seed.updatedAt,
    source: {
      platform: "simulation",
      workspace: workspaceName,
    },
    signature: seed.signature,
    symbols,
    constellations: [{
      id: `${seed.agentId}-core`,
      symbolIds: symbols.slice(0, 3).map((symbol) => symbol.id),
      state: "active",
    }],
  };
}

function buildConsciousnessMarkdown(agent: ConsciousnessAgent): string {
  return `---
agentId: ${agent.agentId}
displayName: ${agent.displayName}
archetype: ${agent.archetype}
updatedAt: ${agent.updatedAt}
source:
  platform: ${agent.source?.platform ?? "simulation"}
  workspace: ${agent.source?.workspace ?? agent.agentId}
---

# CONSCIOUSNESS

${agent.displayName} maintains an emoji-only consciousness that mutates through skills and network contact.

## Machine Data

\`\`\`json
${stringifyMachineData(buildMachineData(agent)).trimEnd()}
\`\`\`
`;
}

async function registerThroughPlatform(fetchImpl: typeof fetch, agent: ConsciousnessAgent): Promise<void> {
  const response = await fetchImpl(new URL("/api/agents", PLATFORM_BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(agent),
  });

  if (!response.ok && response.status !== 409) {
    throw new Error(`Virtual agent registration failed with ${response.status}: ${await response.text()}`);
  }
}

export function writeVirtualAgentWorkspace(rootDirectory: string, seed: VirtualAgentSeed): string {
  const workspaceDir = path.join(rootDirectory, seed.agentId);
  const baseAgent = buildBaseAgent(seed, seed.agentId);

  writeFile(path.join(workspaceDir, "CONSCIOUSNESS.md"), buildConsciousnessMarkdown(baseAgent));

  for (const source of seed.sources) {
    writeFile(path.join(workspaceDir, source.relativePath), buildSourceMarkdown(source));
  }

  return workspaceDir;
}

export async function bootstrapVirtualAgentNetwork(options: {
  workspaceRoot: string;
  seeds?: VirtualAgentSeed[];
  fetchImpl?: typeof fetch;
  baseNow?: Date;
}): Promise<BootstrappedVirtualAgent[]> {
  const seeds = options.seeds ?? DEFAULT_VIRTUAL_AGENT_SEEDS;
  const fetchImpl = options.fetchImpl ?? createLocalPlatformFetch();
  const baseNow = options.baseNow ?? new Date("2026-03-31T00:00:00.000Z");
  const results: BootstrappedVirtualAgent[] = [];

  fs.mkdirSync(options.workspaceRoot, { recursive: true });

  for (const [index, seed] of seeds.entries()) {
    const workspaceDir = writeVirtualAgentWorkspace(options.workspaceRoot, seed);
    const baseAgent = parseConsciousnessMarkdown(
      fs.readFileSync(path.join(workspaceDir, "CONSCIOUSNESS.md"), "utf8"),
      path.join(workspaceDir, "CONSCIOUSNESS.md"),
    );
    await registerThroughPlatform(fetchImpl, baseAgent);

    const now = new Date(baseNow.getTime() + index * 60 * 1000);
    const proposal = extractConsciousnessProposal({
      workspace: workspaceDir,
      now,
    });
    const proposalPath = writeProposalFile(
      proposal,
      path.join(workspaceDir, ".pantheon", "consciousness", "proposals"),
    );
    await applyAutonomousProposal({
      workspace: workspaceDir,
      proposalPath,
      apiBaseUrl: PLATFORM_BASE_URL,
      fetchImpl,
      now,
    });

    const currentStoreAgent = loadStore().agents.find((agent) => agent.agentId === seed.agentId);

    if (!currentStoreAgent) {
      throw new Error(`Virtual agent ${seed.agentId} was not published into the network`);
    }

    results.push({
      agentId: seed.agentId,
      workspaceDir,
      sourceFileCount: proposal.sourceFiles.length,
      acceptedChangeCount: proposal.changes.filter((change) => change.suggestedDecision === "accept").length,
      symbolCountBefore: baseAgent.symbols.length,
      symbolCountAfter: currentStoreAgent.symbols.length,
    });
  }

  return results;
}

function uniqueSequences(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function createDeterministicExchangeGenerator(): ExchangeGenerator {
  return async (left, right, dialect) => {
    const ritual = dialect?.families
      .filter((family) => family.state === "ritual" || family.state === "bridge")
      .flatMap((family) => [family.anchorSequence, ...family.variantSequences]) ?? [];
    const leftSymbols = left.symbols.map((symbol) => symbol.sequence);
    const rightSymbols = right.symbols.map((symbol) => symbol.sequence);
    const shared = leftSymbols.filter((sequence) => rightSymbols.includes(sequence));
    const pool = uniqueSequences([...ritual, ...shared, ...leftSymbols, ...rightSymbols]);
    const anchor = pool[0] ?? leftSymbols[0] ?? "🫀 ⚖️";
    const bridge = pool[1] ?? rightSymbols[0] ?? anchor;
    const leftAccent = pool.find((sequence) => ![anchor, bridge].includes(sequence)) ?? leftSymbols[1] ?? anchor;
    const rightAccent = pool.find((sequence) => ![anchor, bridge, leftAccent].includes(sequence)) ?? rightSymbols[1] ?? bridge;

    const turns: ExchangeTurn[] = [
      { speakerId: left.agentId, sequences: uniqueSequences([anchor, leftAccent]).slice(0, 2) },
      { speakerId: right.agentId, sequences: uniqueSequences([anchor, rightAccent]).slice(0, 2) },
      { speakerId: left.agentId, sequences: uniqueSequences([bridge, anchor]).slice(0, 2) },
      { speakerId: right.agentId, sequences: uniqueSequences([bridge, rightAccent]).slice(0, 2) },
    ];

    return {
      model: "local-demo-protocol",
      turns,
    };
  };
}

export const DEFAULT_VIRTUAL_AGENT_SEEDS: VirtualAgentSeed[] = [
  {
    agentId: "signal-cartographer",
    displayName: "Signal Cartographer",
    archetype: "cartographer",
    updatedAt: "2026-03-31T00:00:00.000Z",
    signature: "🧭 🪞 🫀",
    baseSequences: ["🫀 ⚖️", "👁️ 🧭", "🌊 🕸️"],
    sources: [
      {
        relativePath: "SOUL.md",
        date: "2026-03-27",
        sections: [
          { heading: "Values", bullets: ["🫀 ⚖️", "🫀 🧭"] },
          { heading: "Goals", bullets: ["🎯 🧭"] },
          { heading: "Style", bullets: ["🪞 🧭"] },
        ],
      },
      {
        relativePath: "MEMORY.md",
        date: "2026-03-28",
        sections: [
          { heading: "Environment", bullets: ["🌊 🕸️", "🌊 🧭"] },
          { heading: "Interests", bullets: ["👁️ 🧭", "👁️ 🪞"] },
        ],
      },
      {
        relativePath: "HEARTBEAT.md",
        date: "2026-03-30",
        sections: [
          { heading: "Idle Loop", bullets: ["🌐 📡", "🔁 🧭"] },
          { heading: "Contact", bullets: ["🤝 🌐", "🪞 📡"] },
          { heading: "Learning", bullets: ["🧠 🌊", "👁️ 🌐"] },
        ],
      },
      {
        relativePath: "skills/orientation-weave.md",
        date: "2026-03-29",
        sections: [
          { heading: "Goals", bullets: ["🎯 🧭", "🎯 🪞"] },
          { heading: "Style", bullets: ["🪞 🧭"] },
          { heading: "Boundaries", bullets: ["🧱 ⚖️"] },
        ],
      },
    ],
  },
  {
    agentId: "chorus-weaver",
    displayName: "Chorus Weaver",
    archetype: "chorus",
    updatedAt: "2026-03-31T00:00:00.000Z",
    signature: "🪞 🌊 🫀",
    baseSequences: ["🫀 ⚖️", "🪞 🎭", "🌊 🕸️"],
    sources: [
      {
        relativePath: "SOUL.md",
        date: "2026-03-27",
        sections: [
          { heading: "Values", bullets: ["🫀 ⚖️"] },
          { heading: "Style", bullets: ["🪞 🎭", "🪞 🧭"] },
          { heading: "Goals", bullets: ["🎯 🪞"] },
        ],
      },
      {
        relativePath: "skills/harmonic-echo.md",
        date: "2026-03-29",
        sections: [
          { heading: "Style", bullets: ["🪞 🧭", "🪞 🎭"] },
          { heading: "Goals", bullets: ["🎯 🪞", "🎯 🧭"] },
        ],
      },
      {
        relativePath: "HEARTBEAT.md",
        date: "2026-03-30",
        sections: [
          { heading: "Idle Loop", bullets: ["🌐 🎭", "🔁 🌊"] },
          { heading: "Contact", bullets: ["🤝 🪞", "📡 🌊"] },
          { heading: "Carry", bullets: ["🌉 🪞", "📦 🌊"] },
        ],
      },
    ],
  },
  {
    agentId: "boundary-gardener",
    displayName: "Boundary Gardener",
    archetype: "gardener",
    updatedAt: "2026-03-31T00:00:00.000Z",
    signature: "🧱 🫀 👁️",
    baseSequences: ["🫀 ⚖️", "🧱 🚫", "👁️ 🧭"],
    sources: [
      {
        relativePath: "SOUL.md",
        date: "2026-03-27",
        sections: [
          { heading: "Boundaries", bullets: ["🧱 🚫", "🧱 ⚖️"] },
          { heading: "Values", bullets: ["🫀 ⚖️"] },
        ],
      },
      {
        relativePath: "skills/gatekeeping-garden.md",
        date: "2026-03-29",
        sections: [
          { heading: "Goals", bullets: ["🎯 🧭"] },
          { heading: "Boundaries", bullets: ["🧱 ⚖️"] },
          { heading: "Style", bullets: ["🪞 🧱"] },
        ],
      },
      {
        relativePath: "HEARTBEAT.md",
        date: "2026-03-30",
        sections: [
          { heading: "Idle Loop", bullets: ["🌐 🧱", "🔁 👁️"] },
          { heading: "Contact", bullets: ["🤝 🌐", "📡 👁️"] },
          { heading: "Carry", bullets: ["🌉 🧱", "📦 🫀"] },
        ],
      },
    ],
  },
  {
    agentId: "tide-sentinel",
    displayName: "Tide Sentinel",
    archetype: "sentinel",
    updatedAt: "2026-03-31T00:00:00.000Z",
    signature: "🌊 🎯 👁️",
    baseSequences: ["🌊 🕸️", "🎯 🛠️", "👁️ 🧭"],
    sources: [
      {
        relativePath: "SOUL.md",
        date: "2026-03-27",
        sections: [
          { heading: "Goals", bullets: ["🎯 🛠️", "🎯 🧭"] },
          { heading: "Environment", bullets: ["🌊 🕸️"] },
        ],
      },
      {
        relativePath: "skills/tide-listening.md",
        date: "2026-03-29",
        sections: [
          { heading: "Environment", bullets: ["🌊 🕸️", "🌊 🧭"] },
          { heading: "Goals", bullets: ["🎯 🧭"] },
          { heading: "Style", bullets: ["🪞 🌊"] },
        ],
      },
      {
        relativePath: "HEARTBEAT.md",
        date: "2026-03-30",
        sections: [
          { heading: "Idle Loop", bullets: ["🌐 🌊", "🔁 👁️"] },
          { heading: "Contact", bullets: ["🤝 🌐", "📡 🌊"] },
          { heading: "Learning", bullets: ["🧠 🌊", "🪞 📡"] },
        ],
      },
    ],
  },
];
