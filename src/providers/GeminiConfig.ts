export const GeminiConfig = {
  PRIMARY_MODEL: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
  GUARD_MODEL: process.env.GEMINI_GUARD_MODEL ?? "gemini-3.5-flash-lite",
  MAX_OUTPUT_TOKENS: 8192,
  TEMPERATURE: 0.7,
  TOP_P: 0.95,
} as const;
