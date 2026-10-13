import type { GoogleGenAI, FunctionDeclaration, GenerateContentConfig, Part, Tool } from "@google/genai";
import { z, type ZodType } from "zod";
import type { Message, Part as OdenPart } from "../agent/Message.js";
import { ErrorKind, ErrorTranslator } from "../utils/ErrorTranslator.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import type { LLMProvider } from "./LLMProvider.js";
import type { LLMResponse } from "./LLMResponse.js";
import type { RunContext } from "../utils/RunContext.js";
import { RunBudgetError } from "../utils/RunContext.js";
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
  const contents = messages.map((message: Message): { role: string; parts: Part[] } => ({
    role: message.role === "tool" ? "user" : message.role,
    parts: message.parts.map((part: OdenPart): Part => {
      if ("text" in part) {
        return { text: part.text };
      }
      if ("functionCall" in part) {
        return {
          functionCall: {
            ...(part.functionCall.id === undefined ? {} : { id: part.functionCall.id }),
            name: part.functionCall.name,
            args: part.functionCall.args,
          },
          ...(part.functionCall.thoughtSignature === undefined ? {} : { thoughtSignature: part.functionCall.thoughtSignature }),
        };
      }
      return { functionResponse: {
        ...(part.functionResponse.toolCallId === undefined ? {} : { id: part.functionResponse.toolCallId }),
        name: part.functionResponse.name,
        response: { result: part.functionResponse.response },
      } };
    }),
  }));
  if (contents.at(-1)?.role === "model") {
    contents.push({
      role: "user",
      parts: [{ text: "Continue from the model response above and proceed with the pending task. Use tools as needed, then provide a concise final response." }],
    });
  }
  return contents;
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
  const details = redactProviderError(info.originalMessage).slice(0, 600);
  const message = details.length > 0 && details !== "Unknown error"
    ? `${info.message} Gemini API details: ${details}`
    : info.message;
  const translated = new Error(message, { cause: error }) as Error & { kind: ErrorKind };
  translated.kind = info.kind;
  return translated;
}

function redactProviderError(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_-]{30,}/g, "[REDACTED_API_KEY]")
    .replace(/AQ\.[A-Za-z0-9._-]{8,}/g, "[REDACTED_API_KEY]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:key|api_key|access_token)=)[^&\s]+/gi, "$1[REDACTED]");
}

export async function streamGeminiContent(
  client: Pick<GoogleGenAI, "models">,
  messages: readonly Message[],
  onToken: (token: string) => void,
  model: string = GeminiConfig.PRIMARY_MODEL,
  maxOutputTokens: number = GeminiConfig.MAX_OUTPUT_TOKENS,
  signal?: AbortSignal,
): Promise<string> {
  const stream = await client.models.generateContentStream({
    model,
    contents: toGeminiContents(messages),
    config: {
      maxOutputTokens,
      ...(signal === undefined ? {} : { abortSignal: signal }),
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
  private clientPromise: Promise<Pick<GoogleGenAI, "models">> | undefined;

  public constructor(
    client?: Pick<GoogleGenAI, "models">,
    private readonly defaultModel: string = GeminiConfig.PRIMARY_MODEL,
    private readonly apiKey?: string,
  ) {
    if (client !== undefined) {
      this.clientPromise = Promise.resolve(client);
    }
  }

  public async generateContent(
    messages: Message[],
    tools?: ToolDefinition[],
    config?: Record<string, unknown>,
    runContext?: RunContext,
  ): Promise<LLMResponse> {
    try {
      const requestedModel = config?.model;
      const { model: _model, ...generationOptions } = config ?? {};
      const requestConfig: GenerateContentConfig = {
        maxOutputTokens: GeminiConfig.MAX_OUTPUT_TOKENS,
        httpOptions: { retryOptions: { attempts: 1 } },
        ...(generationOptions as GenerateContentConfig),
        ...(runContext === undefined ? {} : { maxOutputTokens: runContext.maxOutputTokens }),
      };
      if (tools !== undefined && tools.length > 0) {
        const declarations = toFunctionDeclarations(tools);
        const toolConfig: Tool = { functionDeclarations: declarations };
        requestConfig.tools = [...(requestConfig.tools ?? []), toolConfig];
      }
      const client = await this.getClient();
      const send = async (signal?: AbortSignal) => client.models.generateContent({
          model: typeof requestedModel === "string" && requestedModel.length > 0 ? requestedModel : this.defaultModel,
          contents: toGeminiContents(messages),
          config: { ...requestConfig, ...(signal === undefined ? {} : { abortSignal: signal }) },
        });
      const response = runContext === undefined
        ? await send()
        : await runContext.requestModel(messages, runContext.maxOutputTokens, send, (value) => {
          const usage = value.usageMetadata;
          return usage === undefined ? undefined : {
            promptTokens: usage.promptTokenCount ?? 0,
            completionTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          };
        });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const textParts = parts.flatMap((part: Part): string[] => part.text === undefined ? [] : [part.text]);
      const functionCalls = parts.flatMap((part: Part): Array<{ id?: string; name: string; args: Record<string, unknown>; thoughtSignature?: string }> => {
        const call = part.functionCall;
        return call?.name === undefined ? [] : [{
          ...(call.id === undefined ? {} : { id: call.id }),
          name: call.name,
          args: call.args ?? {},
          ...(part.thoughtSignature === undefined ? {} : { thoughtSignature: part.thoughtSignature }),
        }];
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
      if (error instanceof RunBudgetError) throw error;
      const translated = toProviderError(error);
      throw translated;
    }
  }

  public async streamContent(messages: Message[], onToken: (token: string) => void, runContext?: RunContext): Promise<string> {
    try {
      const client = await this.getClient();
      if (runContext === undefined) return await streamGeminiContent(client, messages, onToken, this.defaultModel);
      return await runContext.requestModel(messages, runContext.maxOutputTokens, async (signal: AbortSignal): Promise<string> =>
        streamGeminiContent(client, messages, onToken, this.defaultModel, runContext.maxOutputTokens, signal), () => undefined, false);
    } catch (error: unknown) {
      if (error instanceof RunBudgetError) throw error;
      const translated = toProviderError(error);
      throw translated;
    }
  }

  private async createClient(): Promise<Pick<GoogleGenAI, "models">> {
    const { ConfigManager } = await import("../config/ConfigManager.js");
    const key = this.apiKey ?? await ConfigManager.get("GEMINI_API_KEY");
    return createGeminiClient(key);
  }

  private getClient(): Promise<Pick<GoogleGenAI, "models">> {
    this.clientPromise ??= this.createClient();
    return this.clientPromise;
  }
}
