import type { Message } from "../agent/Message.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import type { LLMResponse } from "./LLMResponse.js";

export interface LLMProvider {
  generateContent(
    messages: Message[],
    tools?: ToolDefinition[],
    config?: Record<string, unknown>,
  ): Promise<LLMResponse>;

  streamContent(
    messages: Message[],
    onToken: (token: string) => void,
  ): Promise<string>;
}
