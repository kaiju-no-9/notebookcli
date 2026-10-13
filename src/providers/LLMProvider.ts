import type { Message } from "../agent/Message.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import type { LLMResponse } from "./LLMResponse.js";
import type { RunContext } from "../utils/RunContext.js";

export interface LLMProvider {
  generateContent(
    messages: Message[],
    tools?: ToolDefinition[],
    config?: Record<string, unknown>,
    runContext?: RunContext,
  ): Promise<LLMResponse>;

  /** Stream a tool-enabled agent response while preserving any function calls in the final result. */
  streamGenerateContent?(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    onToken: (token: string) => void,
    runContext?: RunContext,
  ): Promise<LLMResponse>;

  streamContent(
    messages: Message[],
    onToken: (token: string) => void,
    runContext?: RunContext,
  ): Promise<string>;
}
