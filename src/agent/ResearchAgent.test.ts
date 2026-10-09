import { describe, expect, it } from "bun:test";
import { ResearchAgent } from "./ResearchAgent.js";
import { FakeLLM } from "./FakeLLM.js";
import type { LLMResponse } from "../providers/LLMResponse.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import { z } from "zod";

function response(text: string | null, functionCalls: LLMResponse["functionCalls"] = null): LLMResponse {
  return { text, functionCalls, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
}

const searchTool: ToolDefinition = {
  name: "search",
  description: "Search the web",
  parameters: z.object({ query: z.string() }),
  execute: async (): Promise<string> => "1. Official docs\n   https://example.com/docs\n   Relevant release notes",
};

describe("ResearchAgent", (): void => {
  it("uses only the search tool and returns a structured ResearchBrief", async (): Promise<void> => {
    const provider = new FakeLLM([
      response(null, [{ name: "search", args: { query: "latest release" } }]),
      response(JSON.stringify({
        summary: "The latest release adds useful features.",
        keyFindings: ["A new feature was added."],
        sources: [{ title: "Official docs", url: "https://example.com/docs" }],
      })),
    ]);
    const brief = await new ResearchAgent(provider, searchTool).run("Find the latest release");
    expect(brief).toEqual({
      summary: "The latest release adds useful features.",
      keyFindings: ["A new feature was added."],
      sources: [{ title: "Official docs", url: "https://example.com/docs" }],
    });
    expect(provider.calls.every((call): boolean => call.tools?.map((tool): string => tool.name).join(",") === "search")).toBe(true);
  });

  it("rejects non-search function calls and can recover a brief from plain text", async (): Promise<void> => {
    let executed = false;
    const restrictedSearch: ToolDefinition = { ...searchTool, execute: async (): Promise<string> => { executed = true; return ""; } };
    const provider = new FakeLLM([
      response(null, [{ name: "code_tool", args: { filePath: "x", content: "bad" } }]),
      response("Research completed.\n- Finding one."),
    ]);
    const brief = await new ResearchAgent(provider, restrictedSearch).run("Research safely");
    expect(executed).toBe(false);
    expect(brief.summary).toContain("Research completed");
    expect(brief.keyFindings).toContain("Finding one.");
  });
});
