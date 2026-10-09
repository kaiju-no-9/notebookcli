import { describe, expect, it } from "bun:test";
import { createMemoryTools } from "./MemoryTools.js";
import { MemorySearchRules } from "./MemorySearchRules.js";

describe("MemoryTools", (): void => {
  it("blocks API keys and credential-like values from memory", (): void => {
    expect(MemorySearchRules.validateMemory("setting", "AIza12345678901234567890123456789012345").allowed).toBe(false);
    expect(MemorySearchRules.validateMemory("account", "password=correct-horse-battery-staple").allowed).toBe(false);
    expect(MemorySearchRules.validateMemory("editor", "prefers tabs").allowed).toBe(true);
    expect(MemorySearchRules.validateQuery(" ").allowed).toBe(false);
  });

  it("POSTs safe memory to the configured memories endpoint", async (): Promise<void> => {
    let requestURL = "";
    let requestBody: unknown;
    const tools = createMemoryTools({
      getBaseURL: (): string => "https://memory.example/api/",
      resolve: async (): Promise<readonly string[]> => ["8.8.8.8"],
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        requestURL = input.toString();
        requestBody = JSON.parse(String(init?.body)) as unknown;
        return new Response("{}", { status: 201 });
      },
    });
    const result = await tools.saveMemoryTool.execute({ key: "editor", value: "prefers tabs" });
    expect(requestURL).toBe("https://memory.example/api/memories");
    expect(requestBody).toEqual({ key: "editor", value: "prefers tabs" });
    expect(result).toContain("Memory saved");
  });

  it("GETs a safely encoded query from the search endpoint", async (): Promise<void> => {
    let requestURL = "";
    const tools = createMemoryTools({
      getBaseURL: (): string => "https://memory.example",
      resolve: async (): Promise<readonly string[]> => ["8.8.8.8"],
      fetch: async (input: RequestInfo | URL): Promise<Response> => {
        requestURL = input.toString();
        return Response.json([{ key: "editor", value: "prefers tabs" }]);
      },
    });
    const result = await tools.searchMemoryTool.execute({ query: "editor settings" });
    expect(requestURL).toBe("https://memory.example/memories/search?q=editor+settings");
    expect(result).toContain("prefers tabs");
  });

  it("rejects private memory service addresses before fetching", async (): Promise<void> => {
    let called = false;
    const tools = createMemoryTools({
      getBaseURL: (): string => "https://192.168.1.20",
      resolve: async (): Promise<readonly string[]> => ["192.168.1.20"],
      fetch: async (): Promise<Response> => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });
    const result = await tools.saveMemoryTool.execute({ key: "editor", value: "prefers tabs" });
    expect(result).toContain("not a public HTTPS host");
    expect(called).toBe(false);
  });
});
