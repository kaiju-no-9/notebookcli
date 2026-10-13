import { describe, expect, it } from "bun:test";
import { loadRunLimits } from "./RunLimits.js";

describe("loadRunLimits", (): void => {
  it("loads defaults and validated environment overrides", (): void => {
    expect(loadRunLimits({} as NodeJS.ProcessEnv)).toMatchObject({ maxLLMRequests: 24, maxToolInvocations: 40, maxSubagents: 2 });
    expect(loadRunLimits({ ODEN_MAX_SUBAGENTS: "2" } as NodeJS.ProcessEnv).maxSubagents).toBe(2);
    expect(loadRunLimits({ ODEN_MAX_LLM_REQUESTS: "3", ODEN_MAX_RETRIES: "0" } as NodeJS.ProcessEnv)).toMatchObject({ maxLLMRequests: 3, maxRetries: 0 });
  });

  it("rejects unsafe or malformed limits", (): void => {
    expect(() => loadRunLimits({ ODEN_MAX_LLM_REQUESTS: "nope" } as NodeJS.ProcessEnv)).toThrow("Invalid Oden run limits");
    expect(() => loadRunLimits({ ODEN_MAX_RUN_DURATION_MS: "50" } as NodeJS.ProcessEnv)).toThrow("Invalid Oden run limits");
    expect(() => loadRunLimits({ ODEN_MAX_SUBAGENTS: "4" } as NodeJS.ProcessEnv)).toThrow("Invalid Oden run limits");
  });
});
