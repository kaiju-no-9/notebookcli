import { describe, expect, it } from "bun:test";
import { z } from "zod";
import type { Message } from "../agent/Message.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import { ErrorKind } from "../utils/ErrorTranslator.js";
import { OpenRouterConfig } from "./OpenRouterConfig.js";
import { OpenRouterProvider, toOpenRouterMessages } from "./OpenRouterProvider.js";

type MockFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("OpenRouterProvider", (): void => {
  it("uses OpenRouter chat completions, tool schemas, model overrides, and structured outputs", async (): Promise<void> => {
    let requestUrl = "";
    let requestHeaders: HeadersInit | undefined;
    let requestBody: Record<string, unknown> | undefined;
    const fetcher: MockFetch = async (input, init): Promise<Response> => {
      requestUrl = String(input);
      requestHeaders = init?.headers;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        choices: [{ message: { content: null, tool_calls: [{
          id: "call-openrouter-1",
          function: { name: "inspect", arguments: "{\"path\":\"README.md\"}" },
        }] } }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      });
    };
    const tool: ToolDefinition = {
      name: "inspect",
      description: "Inspect a path",
      parameters: z.object({ path: z.string() }),
      execute: async (): Promise<string> => "ok",
    };
    const provider = new OpenRouterProvider("test-key", "openrouter/free", fetcher);
    const response = await provider.generateContent(
      [{ role: "user", parts: [{ text: "inspect the readme" }] }],
      [tool],
      {
        model: "provider/model",
        responseMimeType: "application/json",
        responseSchema: { type: "object", properties: { safe: { type: "boolean" } }, required: ["safe"] },
      },
    );

    expect(requestUrl).toBe(OpenRouterConfig.API_URL);
    expect(new Headers(requestHeaders).get("Authorization")).toBe("Bearer test-key");
    expect(requestBody?.model).toBe("provider/model");
    expect(requestBody?.messages).toEqual([{ role: "user", content: "inspect the readme" }]);
    expect(requestBody?.tools).toEqual([{
      type: "function",
      function: {
        name: "inspect",
        description: "Inspect a path",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
      },
    }]);
    expect(requestBody?.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "oden_response",
        strict: true,
        schema: { type: "object", properties: { safe: { type: "boolean" } }, required: ["safe"] },
      },
    });
    expect(response).toEqual({
      text: null,
      functionCalls: [{ id: "call-openrouter-1", name: "inspect", args: { path: "README.md" } }],
      usage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 },
    });
  });

  it("maps assistant tool calls and tool results with matching call IDs", (): void => {
    const messages: Message[] = [
      { role: "model", parts: [
        { text: "I will inspect the file." },
        { functionCall: { id: "call-42", name: "inspect", args: { path: "README.md" } } },
      ] },
      { role: "tool", parts: [{ functionResponse: { toolCallId: "call-42", name: "inspect", response: "file contents" } }] },
    ];
    expect(toOpenRouterMessages(messages)).toEqual([
      {
        role: "assistant",
        content: "I will inspect the file.",
        tool_calls: [{ id: "call-42", type: "function", function: { name: "inspect", arguments: "{\"path\":\"README.md\"}" } }],
      },
      { role: "tool", content: "file contents", tool_call_id: "call-42", name: "inspect" },
    ]);
  });

  it("streams SSE tokens while ignoring keepalive comments and usage frames", async (): Promise<void> => {
    const fetcher: MockFetch = async (): Promise<Response> => new Response(
      ": OPENROUTER PROCESSING\n\n"
      + "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n"
      + "data: {\"choices\":[{\"delta\":{\"content\":\" there\"}}]}\n\n"
      + "data: {\"choices\":[{\"delta\":{\"content\":\"\"}}],\"usage\":{\"total_tokens\":2}}\n\n"
      + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
    const provider = new OpenRouterProvider("test-key", "openrouter/free", fetcher);
    const chunks: string[] = [];
    const result = await provider.streamContent([{ role: "user", parts: [{ text: "hello" }] }], (token: string): void => { chunks.push(token); });
    expect(result).toBe("Hello there");
    expect(chunks).toEqual(["Hello", " there"]);
  });

  it("translates OpenRouter authentication failures", async (): Promise<void> => {
    const fetcher: MockFetch = async (): Promise<Response> => jsonResponse({ error: { message: "Invalid API key" } }, 401);
    const provider = new OpenRouterProvider("bad-key", "openrouter/free", fetcher);
    await expect(provider.generateContent([])).rejects.toMatchObject({ kind: ErrorKind.AUTH_ERROR });
  });
});
