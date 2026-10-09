import { describe, expect, it } from "bun:test";
import { FakeLLM } from "../agent/FakeLLM.js";
import { RouteDecision, Supervisor } from "./Supervisor.js";
import type { LLMResponse } from "../providers/LLMResponse.js";

function classification(route: string, reasoning = "test route"): LLMResponse {
  return { text: JSON.stringify({ route, reasoning, confidence: 0.9 }), functionCalls: null, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
}

describe("Supervisor", (): void => {
  it("classifies a greeting as DIRECT", async (): Promise<void> => {
    const result = await new Supervisor(new FakeLLM([classification("DIRECT")])).classify("hello");
    expect(result.route).toBe(RouteDecision.DIRECT);
  });

  it("classifies a coding request as CODE_ONLY", async (): Promise<void> => {
    const result = await new Supervisor(new FakeLLM([classification("CODE_ONLY")])).classify("write a sorting function");
    expect(result.route).toBe(RouteDecision.CODE_ONLY);
  });

  it("classifies a request requiring current docs as RESEARCH_AND_CODE", async (): Promise<void> => {
    const result = await new Supervisor(new FakeLLM([classification("RESEARCH_AND_CODE")])).classify("use the latest React docs to build a component");
    expect(result.route).toBe(RouteDecision.RESEARCH_AND_CODE);
  });

  it("defaults to CODE_ONLY when the provider fails or returns invalid JSON", async (): Promise<void> => {
    const failing = new FakeLLM([]);
    const result = await new Supervisor(failing).classify("change code");
    expect(result).toMatchObject({ route: RouteDecision.CODE_ONLY, confidence: 0 });
    const invalid = await new Supervisor(new FakeLLM([classification("UNKNOWN")])).classify("change code");
    expect(invalid.route).toBe(RouteDecision.CODE_ONLY);
  });
});
