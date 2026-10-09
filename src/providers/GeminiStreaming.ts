import type { GoogleGenAI } from "@google/genai";
import type { Message } from "../agent/Message.js";
import { createGeminiClient, streamGeminiContent, toProviderError } from "./GeminiProvider.js";

export class GeminiStreaming {
  private readonly clientPromise: Promise<Pick<GoogleGenAI, "models">>;

  public constructor(apiKey: string, client?: Pick<GoogleGenAI, "models">) {
    this.clientPromise = client === undefined ? createGeminiClient(apiKey) : Promise.resolve(client);
  }

  public async stream(messages: Message[], onToken: (token: string) => void): Promise<string> {
    try {
      return await streamGeminiContent(await this.clientPromise, messages, onToken);
    } catch (error: unknown) {
      const translated = toProviderError(error);
      throw translated;
    }
  }
}
