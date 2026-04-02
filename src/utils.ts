export function formatScore(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatTokenWeight(value: number): string {
  return value.toFixed(2);
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    );
  } catch {
    return false;
  }
}
