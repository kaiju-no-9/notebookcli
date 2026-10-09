import type { Message } from "./Message.js";
import type { LLMProvider } from "../providers/LLMProvider.js";
import type { LLMResponse } from "../providers/LLMResponse.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";

export interface FakeLLMCall {
  readonly messages: Message[];
  readonly tools: ToolDefinition[] | undefined;
  readonly config: Record<string, unknown> | undefined;
}

export class FakeLLM implements LLMProvider {
  private responseIndex = 0;
  public readonly calls: FakeLLMCall[] = [];

  public constructor(private readonly responses: readonly LLMResponse[]) {}

  public async generateContent(
    messages: Message[],
    tools?: ToolDefinition[],
    config?: Record<string, unknown>,
  ): Promise<LLMResponse> {
    this.calls.push({ messages: structuredClone(messages), tools, config });
    const response = this.responses[this.responseIndex];
    this.responseIndex += 1;
    if (response === undefined) {
      throw new Error("FakeLLM has no response remaining");
    }
    return structuredClone(response);
  }

  public async streamContent(messages: Message[], onToken: (token: string) => void): Promise<string> {
    void messages;
    const response = this.responses[this.responseIndex];
    this.responseIndex += 1;
    if (response === undefined) {
      throw new Error("FakeLLM has no response remaining");
    }
    const text = response.text ?? "";
    if (text.length > 0) {
      onToken(text);
    }
    return text;
  }
}
