export const OpenRouterConfig = {
  API_URL: "https://openrouter.ai/api/v1/chat/completions",
  DEFAULT_MODEL: process.env.OPENROUTER_MODEL ?? "openrouter/free",
  GUARD_MODEL: process.env.OPENROUTER_GUARD_MODEL ?? "openrouter/free",
  MAX_OUTPUT_TOKENS: 8192,
  TEMPERATURE: 0.7,
  TOP_P: 0.95,
} as const;
