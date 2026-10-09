import type { GoogleGenAI, FunctionDeclaration, GenerateContentConfig, Part, Tool } from "@google/genai";
import { z, type ZodType } from "zod";
import type { Message, Part as OdenPart } from "../agent/Message.js";
import { ErrorKind, ErrorTranslator } from "../utils/ErrorTranslator.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import type { LLMProvider } from "./LLMProvider.js";
import type { LLMResponse } from "./LLMResponse.js";
import { GeminiConfig } from "./GeminiConfig.js";

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  const jsonSchema: unknown = z.toJSONSchema(schema, {
    target: "draft-07",
    unrepresentable: "any",
  });
  if (typeof jsonSchema !== "object" || jsonSchema === null || Array.isArray(jsonSchema)) {
    throw new Error("Tool parameter schema must convert to a JSON Schema object");
  }
  const result = { ...(jsonSchema as Record<string, unknown>) };
  delete result.$schema;
  return result;
}

export async function createGeminiClient(apiKey: string): Promise<GoogleGenAI> {
  const { GoogleGenAI: GeminiClient } = await import("@google/genai");
  return new GeminiClient({ apiKey });
}

export function toGeminiContents(messages: readonly Message[]): Array<{ role: string; parts: Part[] }> {
  return messages.map((message: Message): { role: string; parts: Part[] } => ({
    role: message.role === "tool" ? "user" : message.role,
    parts: message.parts.map((part: OdenPart): Part => {
      if ("text" in part) {
        return { text: part.text };
      }
      if ("functionCall" in part) {
        return { functionCall: { name: part.functionCall.name, args: part.functionCall.args } };
      }
      return { functionResponse: { name: part.functionResponse.name, response: { result: part.functionResponse.response } } };
    }),
  }));
}

function toFunctionDeclarations(tools: readonly ToolDefinition[]): FunctionDeclaration[] {
  return tools.map((tool: ToolDefinition): FunctionDeclaration => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: zodToJsonSchema(tool.parameters),
  }));
}

export function toProviderError(error: unknown): Error & { kind: ErrorKind } {
  const info = ErrorTranslator.translate(error);
  const translated = new Error(info.message, { cause: error }) as Error & { kind: ErrorKind };
  translated.kind = info.kind;
  return translated;
}

export async function streamGeminiContent(
  client: Pick<GoogleGenAI, "models">,
  messages: readonly Message[],
  onToken: (token: string) => void,
): Promise<string> {
  const stream = await client.models.generateContentStream({
    model: GeminiConfig.PRIMARY_MODEL,
    contents: toGeminiContents(messages),
    config: {
      maxOutputTokens: GeminiConfig.MAX_OUTPUT_TOKENS,
      temperature: GeminiConfig.TEMPERATURE,
      topP: GeminiConfig.TOP_P,
    },
  });
  let accumulated = "";
  for await (const chunk of stream) {
    const text = chunk.text;
    if (text !== undefined && text.length > 0) {
      onToken(text);
      accumulated += text;
    }
  }
  return accumulated;
}

export class GeminiProvider implements LLMProvider {
  private readonly clientPromise: Promise<Pick<GoogleGenAI, "models">>;

  public constructor(client?: Pick<GoogleGenAI, "models">) {
    this.clientPromise = client === undefined ? this.createClient() : Promise.resolve(client);
  }

  public async generateContent(
    messages: Message[],
    tools?: ToolDefinition[],
    config?: Record<string, unknown>,
  ): Promise<LLMResponse> {
    try {
      const requestConfig: GenerateContentConfig = {
        maxOutputTokens: GeminiConfig.MAX_OUTPUT_TOKENS,
        temperature: GeminiConfig.TEMPERATURE,
        topP: GeminiConfig.TOP_P,
        ...(config as GenerateContentConfig | undefined),
      };
      if (tools !== undefined && tools.length > 0) {
        const declarations = toFunctionDeclarations(tools);
        const toolConfig: Tool = { functionDeclarations: declarations };
        requestConfig.tools = [...(requestConfig.tools ?? []), toolConfig];
      }
      const response = await (await this.clientPromise).models.generateContent({
        model: GeminiConfig.PRIMARY_MODEL,
        contents: toGeminiContents(messages),
        config: requestConfig,
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const textParts = parts.flatMap((part: Part): string[] => part.text === undefined ? [] : [part.text]);
      const functionCalls = parts.flatMap((part: Part): Array<{ name: string; args: Record<string, unknown> }> => {
        const call = part.functionCall;
        return call?.name === undefined ? [] : [{ name: call.name, args: call.args ?? {} }];
      });
      const usage = response.usageMetadata;
      return {
        text: textParts.length > 0 ? textParts.join("") : null,
        functionCalls: functionCalls.length > 0 ? functionCalls : null,
        usage: {
          promptTokens: usage?.promptTokenCount ?? 0,
          completionTokens: usage?.candidatesTokenCount ?? 0,
          totalTokens: usage?.totalTokenCount ?? 0,
        },
      };
    } catch (error: unknown) {
      const translated = toProviderError(error);
      throw translated;
    }
  }

  public async streamContent(messages: Message[], onToken: (token: string) => void): Promise<string> {
    try {
      return await streamGeminiContent(await this.clientPromise, messages, onToken);
    } catch (error: unknown) {
      const translated = toProviderError(error);
      throw translated;
    }
  }

  private async createClient(): Promise<Pick<GoogleGenAI, "models">> {
    const { ConfigManager } = await import("../config/ConfigManager.js");
    const apiKey = await ConfigManager.get("GEMINI_API_KEY");
    return createGeminiClient(apiKey);
  }
}
