import { z } from "zod";
import type { Message } from "../agent/Message.js";
import type { LLMProvider } from "../providers/LLMProvider.js";
import { OpenRouterConfig } from "../providers/OpenRouterConfig.js";
import { SUPERVISOR_PROMPT } from "./SupervisorPrompt.js";

export const RouteDecision = {
  DIRECT: "DIRECT",
  CODE_ONLY: "CODE_ONLY",
  RESEARCH_AND_CODE: "RESEARCH_AND_CODE",
} as const;
export type RouteDecision = (typeof RouteDecision)[keyof typeof RouteDecision];

export interface ClassificationResult {
  readonly route: RouteDecision;
  readonly reasoning: string;
  readonly confidence: number;
}

export interface SupervisorLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

const CLASSIFICATION_SCHEMA = z.object({
  route: z.enum([RouteDecision.DIRECT, RouteDecision.CODE_ONLY, RouteDecision.RESEARCH_AND_CODE]),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export class Supervisor {
  public constructor(private readonly provider: LLMProvider, private readonly logger?: SupervisorLogger) {}

  public async classify(input: string, history: Message[] = []): Promise<ClassificationResult> {
    try {
      const response = await this.provider.generateContent(
        [
          { role: "user", parts: [{ text: SUPERVISOR_PROMPT }] },
          ...history,
          { role: "user", parts: [{ text: input }] },
        ],
        undefined,
        {
          model: OpenRouterConfig.GUARD_MODEL,
          responseMimeType: "application/json",
          responseSchema: z.toJSONSchema(CLASSIFICATION_SCHEMA, { target: "draft-07" }),
        },
      );
      if (response.text === null) {
        throw new Error("Supervisor returned no classification");
      }
      return CLASSIFICATION_SCHEMA.parse(JSON.parse(response.text) as unknown);
    } catch {
      try {
        this.logger?.warn("Supervisor classification failed; routing to coding agent", { route: RouteDecision.CODE_ONLY });
      } catch {
        // Classification fallback remains available when logging is unavailable.
      }
      return { route: RouteDecision.CODE_ONLY, reasoning: "Classification failed; using the coding agent as a safe fallback.", confidence: 0 };
    }
  }
}
