export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LLMResponse {
  text: string | null;
  functionCalls: FunctionCall[] | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
