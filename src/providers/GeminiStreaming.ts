import type { GoogleGenAI } from "@google/genai";
import type { Message } from "../agent/Message.js";
import { createGeminiClient, streamGeminiContent, toProviderError } from "./GeminiProvider.js";
import { GeminiConfig } from "./GeminiConfig.js";
import type { RunContext } from "../utils/RunContext.js";
import { RunBudgetError } from "../utils/RunContext.js";

export class GeminiStreaming {
  private clientPromise: Promise<Pick<GoogleGenAI, "models">> | undefined;

  public constructor(
    private readonly apiKey: string,
    client?: Pick<GoogleGenAI, "models">,
    private readonly model: string = GeminiConfig.PRIMARY_MODEL,
  ) {
    if (client !== undefined) {
      this.clientPromise = Promise.resolve(client);
    }
  }

  public async stream(messages: Message[], onToken: (token: string) => void, runContext?: RunContext): Promise<string> {
    try {
      const client = await this.getClient();
      if (runContext === undefined) return await streamGeminiContent(client, messages, onToken, this.model);
      return await runContext.requestModel(messages, runContext.maxOutputTokens, async (signal: AbortSignal): Promise<string> =>
        streamGeminiContent(client, messages, onToken, this.model, runContext.maxOutputTokens, signal), () => undefined, false);
    } catch (error: unknown) {
      if (error instanceof RunBudgetError) throw error;
      const translated = toProviderError(error);
      throw translated;
    }
  }

  private getClient(): Promise<Pick<GoogleGenAI, "models">> {
    this.clientPromise ??= createGeminiClient(this.apiKey);
    return this.clientPromise;
  }
}
