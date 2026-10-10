import { describe, expect, it } from "bun:test";
import type { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { Message } from "../agent/Message.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import { ErrorKind } from "../utils/ErrorTranslator.js";
import { GeminiProvider, zodToJsonSchema } from "./GeminiProvider.js";
import { GeminiStreaming } from "./GeminiStreaming.js";

interface MockModel {
  generateContent: (request: unknown) => Promise<unknown>;
  generateContentStream: (request: unknown) => Promise<AsyncGenerator<{ text?: string }>>;
}

function mockClient(model: MockModel): Pick<GoogleGenAI, "models"> {
  return { models: model } as unknown as Pick<GoogleGenAI, "models">;
}

function mockResponse(parts: Array<Record<string, unknown>>, status?: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}): unknown {
  return {
    candidates: [{ content: { parts } }],
    usageMetadata: status,
  };
}

describe("GeminiProvider", (): void => {
  it("converts object schemas and omits optional fields from required", (): void => {
    const schema = zodToJsonSchema(z.object({
      name: z.string(),
      optionalLabel: z.string().optional(),
    }));
    expect(schema.type).toBe("object");
    expect(schema.properties).toEqual({
      name: { type: "string" },
      optionalLabel: { type: "string" },
    });
    expect(schema.required).toEqual(["name"]);
  });

  it("converts enums and arrays", (): void => {
    const schema = zodToJsonSchema(z.object({
      mode: z.enum(["fast", "safe"]),
      paths: z.array(z.string()),
      count: z.number().default(1),
      enabled: z.boolean(),
    }));
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.mode?.enum).toEqual(["fast", "safe"]);
    expect(properties.paths?.items).toEqual({ type: "string" });
    expect(properties.count?.default).toBe(1);
    expect(properties.enabled?.type).toBe("boolean");
  });

  it("sends Gemini content and function declarations in the expected format", async (): Promise<void> => {
    const requests: unknown[] = [];
    const model: MockModel = {
      generateContent: async (request: unknown): Promise<unknown> => {
        requests.push(request);
        return mockResponse([{ text: "ready" }]);
      },
      generateContentStream: async (): Promise<AsyncGenerator<{ text?: string }>> => (async function* (): AsyncGenerator<{ text?: string }> {})(),
    };
    const provider = new GeminiProvider(mockClient(model));
    const messages: Message[] = [{ role: "user", parts: [{ text: "inspect" }] }];
    const tool: ToolDefinition = {
      name: "inspect",
      description: "Inspect a path",
      parameters: z.object({ path: z.string() }),
      execute: async (): Promise<string> => "ok",
    };

    const response = await provider.generateContent(messages, [tool]);
    const request = requests[0] as { contents: Array<{ role: string; parts: Array<{ text?: string }> }>; config: { tools: Array<{ functionDeclarations: Array<{ name: string; parametersJsonSchema: Record<string, unknown> }> }> } };
    expect(request.contents[0]?.role).toBe("user");
    expect(request.contents[0]?.parts[0]?.text).toBe("inspect");
    expect(request.config.tools[0]?.functionDeclarations[0]?.name).toBe("inspect");
    expect(request.config.tools[0]?.functionDeclarations[0]?.parametersJsonSchema.type).toBe("object");
    expect(response.text).toBe("ready");
    expect(messages).toEqual([{ role: "user", parts: [{ text: "inspect" }] }]);
  });

  it("parses function call response parts and usage", async (): Promise<void> => {
    const model: MockModel = {
      generateContent: async (): Promise<unknown> => mockResponse(
        [{ functionCall: { name: "read_file", args: { path: "README.md" } } }],
        { promptTokenCount: 8, candidatesTokenCount: 3, totalTokenCount: 11 },
      ),
      generateContentStream: async (): Promise<AsyncGenerator<{ text?: string }>> => (async function* (): AsyncGenerator<{ text?: string }> {})(),
    };
    const response = await new GeminiProvider(mockClient(model)).generateContent([]);
    expect(response.functionCalls).toEqual([{ name: "read_file", args: { path: "README.md" } }]);
    expect(response.text).toBeNull();
    expect(response.usage).toEqual({ promptTokens: 8, completionTokens: 3, totalTokens: 11 });
  });

  it("returns text-only content and null function calls", async (): Promise<void> => {
    const model: MockModel = {
      generateContent: async (): Promise<unknown> => mockResponse([{ text: "hello " }, { text: "there" }]),
      generateContentStream: async (): Promise<AsyncGenerator<{ text?: string }>> => (async function* (): AsyncGenerator<{ text?: string }> {})(),
    };
    const response = await new GeminiProvider(mockClient(model)).generateContent([]);
    expect(response.text).toBe("hello there");
    expect(response.functionCalls).toBeNull();
  });

  it("allows guard calls to select the lighter guard model", async (): Promise<void> => {
    let requestedModel: string | undefined;
    const model: MockModel = {
      generateContent: async (request: unknown): Promise<unknown> => {
        requestedModel = (request as { model: string }).model;
        return mockResponse([{ text: '{"safe":true}' }]);
      },
      generateContentStream: async (): Promise<AsyncGenerator<{ text?: string }>> => (async function* (): AsyncGenerator<{ text?: string }> {})(),
    };
    await new GeminiProvider(mockClient(model)).generateContent([], undefined, { model: "gemini-2.0-flash" });
    expect(requestedModel).toBe("gemini-2.0-flash");
  });

  it("uses a configured default model when a call has no model override", async (): Promise<void> => {
    let requestedModel = "";
    const model: MockModel = {
      generateContent: async (request: unknown): Promise<unknown> => {
        requestedModel = (request as { model: string }).model;
        return mockResponse([{ text: "ok" }]);
      },
      generateContentStream: async (): Promise<AsyncGenerator<{ text?: string }>> => (async function* (): AsyncGenerator<{ text?: string }> {})(),
    };
    await new GeminiProvider(mockClient(model), "gemini-cli-model").generateContent([]);
    expect(requestedModel).toBe("gemini-cli-model");
  });

  it("maps tool responses to Gemini user content", async (): Promise<void> => {
    let sent: unknown;
    const model: MockModel = {
      generateContent: async (request: unknown): Promise<unknown> => {
        sent = request;
        return mockResponse([]);
      },
      generateContentStream: async (): Promise<AsyncGenerator<{ text?: string }>> => (async function* (): AsyncGenerator<{ text?: string }> {})(),
    };
    const messages: Message[] = [{ role: "tool", parts: [{ functionResponse: { name: "inspect", response: "done" } }] }];
    await new GeminiProvider(mockClient(model)).generateContent(messages);
    const request = sent as { contents: Array<{ role: string; parts: Array<{ functionResponse?: { response: Record<string, unknown> } }> }> };
    expect(request.contents[0]?.role).toBe("user");
    expect(request.contents[0]?.parts[0]?.functionResponse?.response).toEqual({ result: "done" });
  });

  it("translates Gemini authentication and rate limit errors", async (): Promise<void> => {
    for (const [status, kind] of [[401, ErrorKind.AUTH_ERROR], [429, ErrorKind.RATE_LIMIT_ERROR]] as const) {
      const model: MockModel = {
        generateContent: async (): Promise<unknown> => {
          throw Object.assign(new Error(`HTTP ${status}`), { status });
        },
        generateContentStream: async (): Promise<AsyncGenerator<{ text?: string }>> => (async function* (): AsyncGenerator<{ text?: string }> {})(),
      };
      await expect(new GeminiProvider(mockClient(model)).generateContent([])).rejects.toMatchObject({ kind });
    }
  });

  it("streams chunks and returns the accumulated response", async (): Promise<void> => {
    const model: MockModel = {
      generateContent: async (): Promise<unknown> => mockResponse([]),
      generateContentStream: async (): Promise<AsyncGenerator<{ text?: string }>> => (async function* (): AsyncGenerator<{ text?: string }> {
        yield { text: "hello " };
        yield { text: "world" };
      })(),
    };
    const provider = new GeminiProvider(mockClient(model));
    const tokens: string[] = [];
    expect(await provider.streamContent([], (token: string): void => { tokens.push(token); })).toBe("hello world");
    expect(tokens).toEqual(["hello ", "world"]);
  });

  it("supports the standalone GeminiStreaming API", async (): Promise<void> => {
    let requestedModel = "";
    const model: MockModel = {
      generateContent: async (): Promise<unknown> => mockResponse([]),
      generateContentStream: async (request: unknown): Promise<AsyncGenerator<{ text?: string }>> => {
        requestedModel = (request as { model: string }).model;
        return (async function* (): AsyncGenerator<{ text?: string }> {
        yield { text: "token" };
        })();
      },
    };
    const chunks: string[] = [];
    const result = await new GeminiStreaming("test-key", mockClient(model), "gemini-cli-model").stream([], (token: string): void => { chunks.push(token); });
    expect(result).toBe("token");
    expect(chunks).toEqual(["token"]);
    expect(requestedModel).toBe("gemini-cli-model");
  });
});
