import { z, type ZodType } from "zod";
import type { Message, Part as OdenPart } from "../agent/Message.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import { ErrorKind, ErrorTranslator } from "../utils/ErrorTranslator.js";
import type { LLMProvider } from "./LLMProvider.js";
import type { LLMResponse } from "./LLMResponse.js";
import { RunBudgetError, type RunContext } from "../utils/RunContext.js";
import { OpenRouterConfig } from "./OpenRouterConfig.js";

const UsageSchema = z.object({
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
}).optional();

const ToolCallSchema = z.object({
  id: z.string(),
  function: z.object({
    name: z.string(),
    arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
  }),
});

const CompletionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.union([z.string(), z.null()]).optional(),
      tool_calls: z.array(ToolCallSchema).optional(),
    }),
  })),
  usage: UsageSchema,
});

const StreamChunkSchema = z.object({
  error: z.object({ message: z.string() }).optional(),
  choices: z.array(z.object({
    delta: z.object({
      content: z.union([z.string(), z.null()]).optional(),
      tool_calls: z.array(z.object({
        index: z.number().int().nonnegative(),
        id: z.string().optional(),
        function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
      })).optional(),
    }).optional(),
  })).optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() }).optional(),
});

interface OpenRouterTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

interface OpenRouterMessage {
  readonly role: "user" | "assistant" | "tool";
  readonly content: string | null;
  readonly tool_calls?: Array<{
    readonly id: string;
    readonly type: "function";
    readonly function: { readonly name: string; readonly arguments: string };
  }>;
  readonly tool_call_id?: string;
  readonly name?: string;
}

type OpenRouterFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonSchema(schema: ZodType): Record<string, unknown> {
  const converted: unknown = z.toJSONSchema(schema, { target: "draft-07", unrepresentable: "any" });
  if (typeof converted !== "object" || converted === null || Array.isArray(converted)) {
    throw new Error("Provider schema must convert to a JSON Schema object");
  }
  const result = { ...(converted as Record<string, unknown>) };
  delete result.$schema;
  return result;
}

export function toOpenRouterMessages(messages: readonly Message[]): OpenRouterMessage[] {
  return messages.flatMap((message: Message, messageIndex: number): OpenRouterMessage[] => {
    if (message.role === "tool") {
      return message.parts.flatMap((part: OdenPart): OpenRouterMessage[] => {
        if (!("functionResponse" in part)) {
          return "text" in part ? [{ role: "tool", content: part.text, tool_call_id: `call_${messageIndex}` }] : [];
        }
        return [{
          role: "tool",
          content: part.functionResponse.response,
          tool_call_id: part.functionResponse.toolCallId ?? `call_${messageIndex}`,
          name: part.functionResponse.name,
        }];
      });
    }

    const contentParts = message.parts.filter((part): part is { text: string } => "text" in part);
    const text = contentParts.map((part): string => part.text).join("");
    const toolCalls = message.role === "model"
      ? message.parts.flatMap((part: OdenPart, partIndex: number) => {
          if (!("functionCall" in part)) {
            return [];
          }
          return [{
            id: part.functionCall.id ?? `call_${messageIndex}_${partIndex}`,
            type: "function" as const,
            function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args) },
          }];
        })
      : [];

    const result: OpenRouterMessage = {
      role: message.role === "model" ? "assistant" : "user",
      content: text.length > 0 ? text : (toolCalls.length > 0 ? null : ""),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    return [result];
  });
}

function openRouterTools(tools: readonly ToolDefinition[]): OpenRouterTool[] {
  return tools.map((tool: ToolDefinition): OpenRouterTool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: jsonSchema(tool.parameters),
    },
  }));
}

function responseFormat(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const schema = config?.responseSchema;
  if (schema === undefined || config?.responseMimeType !== "application/json") {
    return undefined;
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error("Structured response schema must be an object");
  }
  return {
    type: "json_schema",
    json_schema: { name: "oden_response", strict: true, schema },
  };
}

function requestBody(
  model: string,
  messages: readonly Message[],
  tools?: readonly ToolDefinition[],
  config?: Record<string, unknown>,
  stream: boolean = false,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: typeof config?.model === "string" ? config.model : model,
    messages: toOpenRouterMessages(messages),
    max_tokens: typeof config?.maxOutputTokens === "number" ? config.maxOutputTokens : OpenRouterConfig.MAX_OUTPUT_TOKENS,
    temperature: typeof config?.temperature === "number" ? config.temperature : OpenRouterConfig.TEMPERATURE,
    top_p: typeof config?.topP === "number" ? config.topP : OpenRouterConfig.TOP_P,
    stream,
  };
  const format = responseFormat(config);
  if (format !== undefined) {
    body.response_format = format;
  }
  if (tools !== undefined && tools.length > 0) {
    body.tools = openRouterTools(tools);
  }
  return body;
}

function providerError(error: unknown): Error & { kind: ErrorKind } {
  const info = ErrorTranslator.translate(error);
  const translated = new Error(info.message, { cause: error }) as Error & { kind: ErrorKind };
  translated.kind = info.kind;
  return translated;
}

async function errorFromResponse(response: Response): Promise<Error & { status: number; retryAfterMs?: number }> {
  let detail = `OpenRouter returned HTTP ${response.status}`;
  try {
    const body: unknown = await response.json();
    const parsed = z.object({ error: z.object({ message: z.string().optional() }).optional() }).safeParse(body);
    if (parsed.success && parsed.data.error?.message !== undefined) {
      detail = parsed.data.error.message;
    }
  } catch {
    // Preserve the HTTP status when the service response is not JSON.
  }
  const retryHeader = response.headers.get("retry-after-ms") ?? response.headers.get("retry-after");
  const parsedDelay = retryHeader === null ? undefined : Number(retryHeader);
  return Object.assign(new Error(detail), { status: response.status, ...(parsedDelay === undefined || !Number.isFinite(parsedDelay) ? {} : { retryAfterMs: parsedDelay * (response.headers.has("retry-after") ? 1000 : 1) }) });
}

export class OpenRouterProvider implements LLMProvider {
  public constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = OpenRouterConfig.DEFAULT_MODEL,
    private readonly fetcher: OpenRouterFetch = fetch,
  ) {}

  public async generateContent(
    messages: Message[],
    tools?: ToolDefinition[],
    config?: Record<string, unknown>,
    runContext?: RunContext,
  ): Promise<LLMResponse> {
    try {
      const init = (signal?: AbortSignal): RequestInit => ({
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(requestBody(this.defaultModel, messages, tools, { ...config, ...(runContext === undefined ? {} : { maxOutputTokens: runContext.maxOutputTokens }) })),
        ...(signal === undefined ? {} : { signal }),
      });
      const send = async (signal?: AbortSignal): Promise<LLMResponse> => {
        const response = await this.fetcher(OpenRouterConfig.API_URL, init(signal));
        if (!response.ok) throw await errorFromResponse(response);
        const parsed = CompletionSchema.parse(await response.json());
        const result = parsed.choices[0]?.message;
        if (result === undefined) throw new Error("OpenRouter response contained no choices");
        const calls = result.tool_calls?.map((call) => {
          const rawArgs: unknown = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments;
          const args = z.record(z.string(), z.unknown()).parse(rawArgs);
          return { id: call.id, name: call.function.name, args };
        }) ?? [];
        return {
          text: result.content ?? null,
          functionCalls: calls.length > 0 ? calls : null,
          usage: { promptTokens: parsed.usage?.prompt_tokens ?? 0, completionTokens: parsed.usage?.completion_tokens ?? 0, totalTokens: parsed.usage?.total_tokens ?? 0 },
        };
      };
      return runContext === undefined
        ? await send()
        : await runContext.requestModel(messages, runContext.maxOutputTokens, send, (value) => value.usage);
    } catch (error: unknown) {
      if (error instanceof RunBudgetError) throw error;
      throw providerError(error);
    }
  }

  public async streamContent(messages: Message[], onToken: (token: string) => void, runContext?: RunContext): Promise<string> {
    try {
      const send = async (signal?: AbortSignal): Promise<string> => {
        const response = await this.fetcher(OpenRouterConfig.API_URL, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(requestBody(this.defaultModel, messages, undefined, runContext === undefined ? undefined : { maxOutputTokens: runContext.maxOutputTokens }, true)),
          ...(signal === undefined ? {} : { signal }),
        });
        if (!response.ok) throw await errorFromResponse(response);
        if (response.body === null) throw new Error("OpenRouter returned an empty streaming response");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventData: string[] = [];
        let accumulated = "";
        const consumeEvent = (): void => {
          if (eventData.length === 0) return;
          const data = eventData.join("\n");
          eventData = [];
          if (data === "[DONE]") return;
          const chunk = StreamChunkSchema.parse(JSON.parse(data) as unknown);
          if (chunk.error !== undefined) throw new Error(chunk.error.message);
          const token = chunk.choices?.[0]?.delta?.content;
          if (typeof token === "string" && token.length > 0) { onToken(token); accumulated += token; }
        };
        const consumeLine = (line: string): void => {
          if (line.length === 0) consumeEvent();
          else if (line.startsWith(":")) { /* SSE keepalive comment. */ }
          else if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) { buffer += decoder.decode(); break; }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) consumeLine(line);
        }
        if (buffer.length > 0) consumeLine(buffer);
        consumeEvent();
        return accumulated;
      };
      return runContext === undefined
        ? await send()
        : await runContext.requestModel(messages, runContext.maxOutputTokens, send, () => undefined, false);
    } catch (error: unknown) {
      if (error instanceof RunBudgetError) throw error;
      throw providerError(error);
    }
  }

  public async streamGenerateContent(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    onToken: (token: string) => void,
    runContext?: RunContext,
  ): Promise<LLMResponse> {
    try {
      const send = async (signal?: AbortSignal): Promise<LLMResponse> => {
        const response = await this.fetcher(OpenRouterConfig.API_URL, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(requestBody(this.defaultModel, messages, tools, runContext === undefined ? undefined : { maxOutputTokens: runContext.maxOutputTokens }, true)),
          ...(signal === undefined ? {} : { signal }),
        });
        if (!response.ok) throw await errorFromResponse(response);
        if (response.body === null) throw new Error("OpenRouter returned an empty streaming response");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const toolCalls = new Map<number, { id?: string; name: string; arguments: string }>();
        let text = "";
        let buffer = "";
        let eventData: string[] = [];
        let usage: LLMResponse["usage"] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        const consumeEvent = (): void => {
          if (eventData.length === 0) return;
          const data = eventData.join("\n");
          eventData = [];
          if (data === "[DONE]") return;
          const chunk = StreamChunkSchema.parse(JSON.parse(data) as unknown);
          if (chunk.error !== undefined) throw new Error(chunk.error.message);
          if (chunk.usage !== undefined) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
          }
          for (const choice of chunk.choices ?? []) {
            const delta = choice.delta;
            const token = delta?.content;
            if (typeof token === "string" && token.length > 0) {
              text += token;
              onToken(token);
            }
            for (const call of delta?.tool_calls ?? []) {
              const existing = toolCalls.get(call.index) ?? { name: "", arguments: "" };
              if (call.id !== undefined) existing.id = call.id;
              if (call.function?.name !== undefined) existing.name += call.function.name;
              if (call.function?.arguments !== undefined) existing.arguments += call.function.arguments;
              toolCalls.set(call.index, existing);
            }
          }
        };
        const consumeLine = (line: string): void => {
          if (line.length === 0) consumeEvent();
          else if (line.startsWith(":")) { /* SSE keepalive comment. */ }
          else if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
        };
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { buffer += decoder.decode(); break; }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) consumeLine(line);
          }
          if (buffer.length > 0) consumeLine(buffer);
          consumeEvent();
        } catch (error: unknown) {
          await reader.cancel(error).catch((): void => undefined);
          throw error;
        }
        const calls = [...toolCalls.entries()].sort(([left], [right]): number => left - right).map(([index, call]) => {
          if (call.name.length === 0) throw new Error(`OpenRouter stream omitted tool name at index ${index}`);
          const args = z.record(z.string(), z.unknown()).parse(JSON.parse(call.arguments || "{}") as unknown);
          return { id: call.id ?? `stream_call_${index}`, name: call.name, args };
        });
        return { text: text.length > 0 ? text : null, functionCalls: calls.length > 0 ? calls : null, usage };
      };
      return runContext === undefined
        ? await send()
        : await runContext.requestModel(messages, runContext.maxOutputTokens, send, (value) => value.usage, false);
    } catch (error: unknown) {
      if (error instanceof RunBudgetError) throw error;
      throw providerError(error);
    }
  }

  public async stream(messages: Message[], onToken: (token: string) => void, runContext?: RunContext): Promise<string> {
    return this.streamContent(messages, onToken, runContext);
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Title": "Oden",
    };
  }
}
