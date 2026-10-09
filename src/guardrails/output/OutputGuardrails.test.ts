import { describe, expect, it } from "bun:test";
import type { LLMProvider } from "../../providers/LLMProvider.js";
import type { LLMResponse } from "../../providers/LLMResponse.js";
import { OutputGuardrails } from "./OutputGuardrails.js";

function providerReturning(text: string | null): LLMProvider {
  return {
    generateContent: async (): Promise<LLMResponse> => ({
      text,
      functionCalls: null,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
    streamContent: async (): Promise<string> => "",
  };
}

function noOpLogger(): { warn: (message: string, meta?: Record<string, unknown>) => void } {
  return { warn: (_message: string, _meta?: Record<string, unknown>): void => undefined };
}

describe("OutputGuardrails", (): void => {
  it("blocks output containing secrets before calling the LLM", async (): Promise<void> => {
    let called = false;
    const provider: LLMProvider = {
      ...providerReturning(null),
      generateContent: async (): Promise<LLMResponse> => {
        called = true;
        return { text: null, functionCalls: null, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      },
    };
    const result = await new OutputGuardrails(provider, noOpLogger()).check("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(result).toMatchObject({ allowed: false, stage: "secret_scan" });
    expect(called).toBe(false);
  });

  it("returns structured LLM classification", async (): Promise<void> => {
    const result = await new OutputGuardrails(
      providerReturning('{"safe":false,"reason":"unsafe response","confidence":0.8}'),
      noOpLogger(),
    ).check("Here is a risky response");
    expect(result).toMatchObject({ allowed: false, reason: "unsafe response", confidence: 0.8, stage: "llm_classifier" });
  });

  it("fails open when the classifier errors", async (): Promise<void> => {
    const provider: LLMProvider = {
      generateContent: async (): Promise<LLMResponse> => { throw new Error("network unavailable"); },
      streamContent: async (): Promise<string> => "",
    };
    const result = await new OutputGuardrails(provider, noOpLogger()).check("ordinary response");
    expect(result).toMatchObject({ allowed: true, stage: "llm_fail_open" });
  });
});
