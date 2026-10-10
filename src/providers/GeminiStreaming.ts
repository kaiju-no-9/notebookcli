import type { GoogleGenAI } from "@google/genai";
import type { Message } from "../agent/Message.js";
import { createGeminiClient, streamGeminiContent, toProviderError } from "./GeminiProvider.js";
import { GeminiConfig } from "./GeminiConfig.js";

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

  public async stream(messages: Message[], onToken: (token: string) => void): Promise<string> {
    try {
      return await streamGeminiContent(await this.getClient(), messages, onToken, this.model);
    } catch (error: unknown) {
      const translated = toProviderError(error);
      throw translated;
    }
  }

  private getClient(): Promise<Pick<GoogleGenAI, "models">> {
    this.clientPromise ??= createGeminiClient(this.apiKey);
    return this.clientPromise;
  }
}
