export type ProviderType = "gemini" | "openrouter";

export interface ModelOption {
  readonly id: string;
  readonly label: string;
  readonly tier: "free" | "fast" | "balanced" | "powerful";
}

export const GEMINI_MODELS: readonly ModelOption[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Recommended)", tier: "balanced" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (Lighter and faster)", tier: "fast" },
];

export const OPENROUTER_MODELS: readonly ModelOption[] = [
  { id: "openrouter/free", label: "OpenRouter Free Router (Recommended)", tier: "free" },
];

export function getModelsForProvider(provider: ProviderType): readonly ModelOption[] {
  return provider === "gemini" ? GEMINI_MODELS : OPENROUTER_MODELS;
}

export function getDefaultModel(provider: ProviderType): string {
  return getModelsForProvider(provider)[0]?.id ?? "openrouter/free";
}
