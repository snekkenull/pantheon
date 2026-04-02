import type { ConsciousnessAgent, ConsciousnessSymbol } from "./types.js";

const EMOJI_TEXT_PATTERN = /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\s]+$/u;

export function normalizeSymbol(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function isEmojiOnly(value: string): boolean {
  const normalized = normalizeSymbol(value);
  return normalized.length > 0 && EMOJI_TEXT_PATTERN.test(normalized);
}

export function ensureEmojiOnly(value: string): string {
  const normalized = normalizeSymbol(value);
  if (!isEmojiOnly(normalized)) {
    throw new Error(`Expected emoji-only content, received: ${value}`);
  }
  return normalized;
}

export function getSymbolSurfaceKey(symbol: Pick<ConsciousnessSymbol, "sequence">): string {
  return normalizeSymbol(symbol.sequence);
}

export function getAgentSignature(
  agent: Pick<ConsciousnessAgent, "signature"> & Partial<Pick<ConsciousnessAgent, "symbols">>,
): string {
  if (agent.signature) {
    return normalizeSymbol(agent.signature);
  }

  const fallback = agent.symbols
    ?.slice(0, 3)
    .map((symbol) => normalizeSymbol(symbol.sequence))
    .join(" ")
    .trim();

  return fallback && fallback.length > 0 ? fallback : "◌";
}
