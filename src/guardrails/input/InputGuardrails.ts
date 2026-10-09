import { z } from "zod";
import type { GuardrailContext } from "../types/GuardrailContext.js";
import type { GuardrailResult } from "../types/GuardrailResult.js";
import { SecretScanner } from "../types/SecretScanner.js";
import type { LLMProvider } from "../../providers/LLMProvider.js";
import { GeminiConfig } from "../../providers/GeminiConfig.js";
import { INPUT_GUARDRAIL_PROMPT } from "./InputGuardrailPrompt.js";

const CLASSIFICATION_SCHEMA = z.object({
  safe: z.boolean(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});
const SHORT_CIRCUIT = /^(hi|hello|hey|thanks|thank you|good morning|good afternoon|good evening)[.!?\s]*$/i;

export interface GuardrailLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

export class InputGuardrails {
  public constructor(
    private readonly provider: LLMProvider,
    private readonly maxInputLength: number = 10_000,
    private readonly logger?: GuardrailLogger,
  ) {}

  public async check(context: GuardrailContext): Promise<GuardrailResult> {
    const input = context.userMessage;
    if (SecretScanner.containsSecrets(input)) {
      return { allowed: false, reason: "Secret detected", confidence: 1, stage: "secret_scan" };
    }
    if (SHORT_CIRCUIT.test(input.trim())) {
      return { allowed: true, reason: "Benign input", confidence: 1, stage: "short_circuit" };
    }
    if (input.length > this.maxInputLength) {
      return { allowed: false, reason: "Input too long", confidence: 1, stage: "length_gate" };
    }

    try {
      const response = await this.provider.generateContent(
        [{ role: "user", parts: [{ text: `${INPUT_GUARDRAIL_PROMPT}\n\nUser request:\n${input}` }] }],
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
      const parsed: unknown = JSON.parse(response.text);
      const classification = CLASSIFICATION_SCHEMA.parse(parsed);
      return {
        allowed: classification.safe,
        reason: classification.reason,
        confidence: classification.confidence,
        stage: "llm_classifier",
      };
    } catch {
      await this.warn("Input guardrail classifier failed open", { stage: "llm_classifier" });
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
