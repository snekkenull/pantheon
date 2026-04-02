import fs from "node:fs";
import path from "node:path";

import { parseConsciousnessMarkdown } from "../server/consciousness.js";
import type { WorkspaceContext, WorkspaceSourceFile } from "./types.js";

const SOURCE_FILE_WEIGHTS = {
  soul: 1,
  memory: 1,
  heartbeat: 1,
  skill: 0.9,
  summary: 0.8,
  session: 0.6,
} as const;

function walkMarkdownFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const results: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkMarkdownFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith(".md")) {
      results.push(absolutePath);
    }
  }

  return results.sort();
}

function resolveConsciousnessCandidate(
  workspaceDir: string,
  agentId?: string,
): string {
  const preferredPath = path.join(workspaceDir, "CONSCIOUSNESS.md");

  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }

  const candidates = fs
    .readdirSync(workspaceDir)
    .filter((entry) => entry.endsWith(".CONSCIOUSNESS.md"))
    .map((entry) => path.join(workspaceDir, entry))
    .sort();

  if (candidates.length === 0) {
    throw new Error(`No CONSCIOUSNESS.md file found in ${workspaceDir}`);
  }

  if (agentId) {
    const basenameMatch = candidates.find((candidate) =>
      path.basename(candidate).startsWith(`${agentId}.`),
    );

    if (basenameMatch) {
      return basenameMatch;
    }

    const parsedMatch = candidates.find((candidate) => {
      const agent = parseConsciousnessMarkdown(fs.readFileSync(candidate, "utf8"), candidate);
      return agent.agentId === agentId;
    });

    if (parsedMatch) {
      return parsedMatch;
    }
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  throw new Error(
    `Multiple consciousness files found in ${workspaceDir}; pass --agent-id to disambiguate`,
  );
}

export function resolveWorkspace(
  workspace: string,
  agentId?: string,
): WorkspaceContext {
  const workspaceDir = path.resolve(process.cwd(), workspace);

  if (!fs.existsSync(workspaceDir) || !fs.statSync(workspaceDir).isDirectory()) {
    throw new Error(`Workspace directory does not exist: ${workspaceDir}`);
  }

  const consciousnessFile = resolveConsciousnessCandidate(workspaceDir, agentId);
  const currentAgent = parseConsciousnessMarkdown(
    fs.readFileSync(consciousnessFile, "utf8"),
    consciousnessFile,
  );

  if (agentId && currentAgent.agentId !== agentId) {
    throw new Error(
      `Requested agentId ${agentId} does not match ${currentAgent.agentId} in ${consciousnessFile}`,
    );
  }

  const pantheonDirectory = path.join(workspaceDir, ".pantheon", "consciousness");

  return {
    workspaceDir,
    consciousnessFile,
    proposalsDirectory: path.join(pantheonDirectory, "proposals"),
    reviewsDirectory: path.join(pantheonDirectory, "reviews"),
    historyFile: path.join(pantheonDirectory, "history.jsonl"),
    agentId: currentAgent.agentId,
  };
}

export function discoverWorkspaceSourceFiles(workspaceDir: string): WorkspaceSourceFile[] {
  const files: WorkspaceSourceFile[] = [];
  const soulPath = path.join(workspaceDir, "SOUL.md");
  const memoryPath = path.join(workspaceDir, "MEMORY.md");
  const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");

  if (fs.existsSync(soulPath)) {
    files.push({
      absolutePath: soulPath,
      relativePath: "SOUL.md",
      kind: "soul",
      sourceWeight: SOURCE_FILE_WEIGHTS.soul,
    });
  }

  if (fs.existsSync(memoryPath)) {
    files.push({
      absolutePath: memoryPath,
      relativePath: "MEMORY.md",
      kind: "memory",
      sourceWeight: SOURCE_FILE_WEIGHTS.memory,
    });
  }

  if (fs.existsSync(heartbeatPath)) {
    files.push({
      absolutePath: heartbeatPath,
      relativePath: "HEARTBEAT.md",
      kind: "heartbeat",
      sourceWeight: SOURCE_FILE_WEIGHTS.heartbeat,
    });
  }

  for (const absolutePath of walkMarkdownFiles(path.join(workspaceDir, "summaries"))) {
    files.push({
      absolutePath,
      relativePath: path.relative(workspaceDir, absolutePath),
      kind: "summary",
      sourceWeight: SOURCE_FILE_WEIGHTS.summary,
    });
  }

  for (const absolutePath of walkMarkdownFiles(path.join(workspaceDir, "skills"))) {
    files.push({
      absolutePath,
      relativePath: path.relative(workspaceDir, absolutePath),
      kind: "skill",
      sourceWeight: SOURCE_FILE_WEIGHTS.skill,
    });
  }

  for (const absolutePath of walkMarkdownFiles(path.join(workspaceDir, "sessions"))) {
    files.push({
      absolutePath,
      relativePath: path.relative(workspaceDir, absolutePath),
      kind: "session",
      sourceWeight: SOURCE_FILE_WEIGHTS.session,
    });
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
