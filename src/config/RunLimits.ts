import { z } from "zod";

export interface RunLimits {
  readonly maxLLMRequests: number;
  readonly maxToolInvocations: number;
  readonly maxDurationMs: number;
  readonly maxTokens: number;
  readonly maxOutputTokens: number;
  readonly maxRetries: number;
  readonly maxRetryDelayMs: number;
  readonly maxSubagents: number;
}

const envInteger = (fallback: number, minimum: number, maximum: number): z.ZodType<number> =>
  z.preprocess(
    (value: unknown): number => typeof value === "string" && value.trim().length > 0 ? Number(value) : fallback,
    z.number().int().min(minimum).max(maximum),
  );

const runLimitsSchema = z.object({
  maxLLMRequests: envInteger(24, 1, 500),
  maxToolInvocations: envInteger(40, 1, 1_000),
  maxDurationMs: envInteger(180_000, 1_000, 1_800_000),
  maxTokens: envInteger(65_536, 1_024, 2_000_000),
  maxOutputTokens: envInteger(2_048, 64, 32_768),
  maxRetries: envInteger(2, 0, 5),
  maxRetryDelayMs: envInteger(5_000, 0, 60_000),
  maxSubagents: envInteger(2, 0, 3),
});

export function loadRunLimits(environment: NodeJS.ProcessEnv = process.env): RunLimits {
  const parsed = runLimitsSchema.safeParse({
    maxLLMRequests: environment.ODEN_MAX_LLM_REQUESTS,
    maxToolInvocations: environment.ODEN_MAX_TOOL_INVOCATIONS,
    maxDurationMs: environment.ODEN_MAX_RUN_DURATION_MS,
    maxTokens: environment.ODEN_MAX_RUN_TOKENS,
    maxOutputTokens: environment.ODEN_MAX_OUTPUT_TOKENS,
    maxRetries: environment.ODEN_MAX_RETRIES,
    maxRetryDelayMs: environment.ODEN_MAX_RETRY_DELAY_MS,
    maxSubagents: environment.ODEN_MAX_SUBAGENTS,
  });
  if (!parsed.success) {
    throw new Error(`Invalid Oden run limits: ${parsed.error.issues.map((issue): string => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}
