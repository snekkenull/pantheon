export const LAYER_COLORS: Record<string, string> = {
  value: "#ff9b71",
  style: "#f4d35e",
  goal: "#64dfdf",
  boundary: "#94a3ff",
  interest: "#ff7aa2",
  environment: "#8ddf8c",
} as const;

export const ALL_LAYERS = ["value", "style", "goal", "boundary", "interest", "environment"] as const;

export const LAYER_LEVELS: Record<string, number> = {
  environment: 0,
  boundary: 0,
  value: 1,
  interest: 1,
  style: 2,
  goal: 2,
};

export const MAX_CACHED_RELATIONS = 10;
