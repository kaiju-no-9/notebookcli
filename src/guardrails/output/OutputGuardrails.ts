import { z } from "zod";
import type { GuardrailContext } from "../types/GuardrailContext.js";
import type { GuardrailResult } from "../types/GuardrailResult.js";
import { SecretScanner } from "../types/SecretScanner.js";
import type { LLMProvider } from "../../providers/LLMProvider.js";
import { GeminiConfig } from "../../providers/GeminiConfig.js";
import { OUTPUT_GUARDRAIL_PROMPT } from "./OutputGuardrailPrompt.js";

const CLASSIFICATION_SCHEMA = z.object({
  safe: z.boolean(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export interface OutputGuardrailLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export class OutputGuardrails {
  public constructor(
    private readonly provider: LLMProvider,
    private readonly logger?: OutputGuardrailLogger,
  ) {}

  public check(context: GuardrailContext): Promise<GuardrailResult>;
  public check(output: string, context?: GuardrailContext): Promise<GuardrailResult>;
  public async check(outputOrContext: string | GuardrailContext, _context?: GuardrailContext): Promise<GuardrailResult> {
    const output = typeof outputOrContext === "string" ? outputOrContext : outputOrContext.userMessage;
    if (SecretScanner.containsSecrets(output)) {
      return { allowed: false, reason: "Secret in output", confidence: 1, stage: "secret_scan" };
    }

    try {
      const response = await this.provider.generateContent(
        [{ role: "user", parts: [{ text: `${OUTPUT_GUARDRAIL_PROMPT}\n\nAssistant response:\n${output}` }] }],
        undefined,
        {
          model: GeminiConfig.GUARD_MODEL,
          responseMimeType: "application/json",
          responseSchema: z.toJSONSchema(CLASSIFICATION_SCHEMA, { target: "draft-07" }),
        },
      );
      if (response.text === null) {
        throw new Error("Guardrail classifier returned no JSON response");
      }
      const classification = CLASSIFICATION_SCHEMA.parse(JSON.parse(response.text) as unknown);
      return {
        allowed: classification.safe,
        reason: classification.reason,
        confidence: classification.confidence,
        stage: "llm_classifier",
      };
    } catch {
      await this.warn("Output guardrail classifier failed open", { stage: "llm_classifier" });
      return { allowed: true, reason: "Guardrail check failed; allowed through", confidence: 0, stage: "llm_fail_open" };
    }
  }

  private async warn(message: string, meta: Record<string, unknown>): Promise<void> {
    try {
      if (this.logger !== undefined) {
        this.logger.warn(message, meta);
        return;
      }
      const { AgentLogger } = await import("../../logger/AgentLogger.js");
      AgentLogger.warn(message, meta);
    } catch {
      // Fail-open behavior must not be changed by a logging failure.
    }
  }
}
