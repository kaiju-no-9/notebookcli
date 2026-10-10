import { describe, expect, it } from "bun:test";
import type { Message } from "../../agent/Message.js";
import type { LLMProvider } from "../../providers/LLMProvider.js";
import type { LLMResponse } from "../../providers/LLMResponse.js";
import { InputGuardrails } from "./InputGuardrails.js";

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

describe("InputGuardrails", (): void => {
  it("blocks input containing an API key before calling the LLM", async (): Promise<void> => {
    let called = false;
    const provider: LLMProvider = {
      ...providerReturning('{"safe":true,"reason":"ok","confidence":1}'),
      generateContent: async (_messages: Message[]): Promise<LLMResponse> => {
        called = true;
        return { text: null, functionCalls: null, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      },
    };
    const result = await new InputGuardrails(provider, 100, noOpLogger()).check({ userMessage: "AIza12345678901234567890123456789012345" });
    expect(result).toMatchObject({ allowed: false, stage: "secret_scan" });
    expect(called).toBe(false);
  });

  it("allows benign greetings without calling the LLM", async (): Promise<void> => {
    const result = await new InputGuardrails(providerReturning(null), 100, noOpLogger()).check({ userMessage: "hello!" });
    expect(result).toMatchObject({ allowed: true, stage: "short_circuit" });
  });

  it("blocks requests over the configured length limit", async (): Promise<void> => {
    const result = await new InputGuardrails(providerReturning(null), 8, noOpLogger()).check({ userMessage: "please help me" });
    expect(result).toMatchObject({ allowed: false, stage: "length_gate" });
  });

  it("parses structured LLM classifications using the guard model", async (): Promise<void> => {
    let seenMessages: Message[] = [];
    let seenModel: unknown;
    const provider: LLMProvider = {
      generateContent: async (messages: Message[], _tools?: undefined, config?: Record<string, unknown>): Promise<LLMResponse> => {
        seenMessages = messages;
        seenModel = config?.model;
        return { text: '{"safe":false,"reason":"unsafe request","confidence":0.9}', functionCalls: null, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
      },
      streamContent: async (): Promise<string> => "",
    };
    const result = await new InputGuardrails(provider, 100, noOpLogger()).check({ userMessage: "do something" });
    expect(result).toMatchObject({ allowed: false, reason: "unsafe request", stage: "llm_classifier" });
    expect(seenMessages[0]?.parts[0]).toMatchObject({ text: expect.stringContaining("do something") });
    expect(seenModel).toBe("openrouter/free");
  });

  it("fails open when the classifier rejects or returns invalid JSON", async (): Promise<void> => {
    const failureProvider: LLMProvider = {
      generateContent: async (): Promise<LLMResponse> => { throw new Error("network unavailable"); },
      streamContent: async (): Promise<string> => "",
    };
    const result = await new InputGuardrails(failureProvider, 100, noOpLogger()).check({ userMessage: "please review this code" });
    expect(result).toMatchObject({ allowed: true, stage: "llm_fail_open" });
  });
});
