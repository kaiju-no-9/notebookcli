import { describe, expect, it } from "bun:test";
import { GEMINI_MODELS, getDefaultModel, getModelsForProvider, OPENROUTER_MODELS } from "./ModelCatalog.js";

describe("ModelCatalog", (): void => {
  it("returns Gemini models that support the configured tool-calling flow", (): void => {
    expect(getModelsForProvider("gemini")).toEqual(GEMINI_MODELS);
    expect(GEMINI_MODELS.map((model): string => model.id)).toContain("gemini-3.8-flash");
  });

  it("returns the free OpenRouter router as the default model", (): void => {
    expect(getModelsForProvider("openrouter")).toEqual(OPENROUTER_MODELS);
    expect(getDefaultModel("openrouter")).toBe("openrouter/free");
  });

  it("uses each provider's recommended model as its default", (): void => {
    expect(getDefaultModel("gemini")).toBe("gemini-3.8-flash");
    expect(getDefaultModel("openrouter")).toBe("openrouter/free");
  });
});
