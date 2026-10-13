import { describe, expect, it } from "bun:test";
import { RunContext, RunBudgetError, type ModelUsage } from "./RunContext.js";
import type { RunLimits } from "../config/RunLimits.js";

const limits: RunLimits = {
  maxLLMRequests: 2, maxToolInvocations: 1, maxDurationMs: 10_000,
  maxTokens: 1_000, maxOutputTokens: 100, maxRetries: 0, maxRetryDelayMs: 0,
};
const usage = (totalTokens: number): ModelUsage => ({ promptTokens: totalTokens, completionTokens: 0, totalTokens });

describe("RunContext", (): void => {
  it("counts physical model requests and observed usage across calls", async (): Promise<void> => {
    const context = new RunContext(limits);
    await context.requestModel([{ role: "user", content: "hello" }], 10, async (): Promise<string> => "ok", (): ModelUsage => usage(12));
    await context.requestModel([{ role: "user", content: "again" }], 10, async (): Promise<string> => "ok", (): ModelUsage => usage(8));
    expect(context.snapshot()).toMatchObject({ requestAttempts: 2, successfulResponses: 2, observedTokens: 20 });
    await expect(context.requestModel([], 10, async (): Promise<string> => "no", (): undefined => undefined)).rejects.toBeInstanceOf(RunBudgetError);
  });

  it("enforces tool and estimated-token budgets", async (): Promise<void> => {
    const context = new RunContext({ ...limits, maxTokens: 20 });
    await expect(context.requestModel([{ role: "user", content: "x".repeat(200) }], 10, async (): Promise<string> => "no", (): undefined => undefined)).rejects.toBeInstanceOf(RunBudgetError);
    context.recordToolInvocation();
    expect(() => context.recordToolInvocation()).toThrow(RunBudgetError);
  });

  it("retries transient failures only within configured bounds", async (): Promise<void> => {
    let calls = 0;
    const context = new RunContext({ ...limits, maxRetries: 1 }, Date.now, async (): Promise<void> => undefined, (): number => 0);
    const result = await context.requestModel([], 10, async (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("temporary network failure"), { code: "ECONNRESET" });
      return "ok";
    }, (): ModelUsage => usage(2));
    expect(result).toBe("ok");
    expect(context.snapshot()).toMatchObject({ requestAttempts: 2, retries: 1 });
  });
});
