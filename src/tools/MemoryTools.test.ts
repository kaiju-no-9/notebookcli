import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "../config/ConfigManager.js";
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

  it("saves memory to Supermemory with bearer auth and the documented payload", async (): Promise<void> => {
    let requestURL = "";
    let requestHeaders: Headers | undefined;
    let requestBody: unknown;
    const tools = createMemoryTools({
      getBaseURL: (): string => "https://api.supermemory.ai/v3",
      getApiKey: (): string => "sm_test_secret",
      resolve: async (): Promise<readonly string[]> => ["8.8.8.8"],
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        requestURL = input.toString();
        requestHeaders = new Headers(init?.headers);
        requestBody = JSON.parse(String(init?.body)) as unknown;
        return new Response("{}", { status: 200 });
      },
    });
    const result = await tools.saveMemoryTool.execute({ key: "editor", value: "prefers tabs" });
    expect(requestURL).toBe("https://api.supermemory.ai/v3/memories");
    expect(requestHeaders?.get("authorization")).toBe("Bearer sm_test_secret");
    expect(requestBody).toEqual({ content: "editor: prefers tabs", customId: "editor" });
    expect(result).toContain("Memory saved");
  });

  it("searches Supermemory using its authenticated POST endpoint", async (): Promise<void> => {
    let requestURL = "";
    let requestMethod = "";
    let requestHeaders: Headers | undefined;
    let requestBody: unknown;
    const tools = createMemoryTools({
      getBaseURL: (): string => "https://api.supermemory.ai/v3",
      getApiKey: (): string => "sm_test_secret",
      resolve: async (): Promise<readonly string[]> => ["8.8.8.8"],
      fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        requestURL = input.toString();
        requestMethod = String(init?.method);
        requestHeaders = new Headers(init?.headers);
        requestBody = JSON.parse(String(init?.body)) as unknown;
        return Response.json({ results: [{ content: "prefers tabs" }] });
      },
    });
    const result = await tools.searchMemoryTool.execute({ query: "editor settings" });
    expect(requestURL).toBe("https://api.supermemory.ai/v3/search");
    expect(requestMethod).toBe("POST");
    expect(requestHeaders?.get("authorization")).toBe("Bearer sm_test_secret");
    expect(requestBody).toEqual({ q: "editor settings" });
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

  it("reads MEMORY_API_URL from ConfigManager on each tool call", async (): Promise<void> => {
    const originalHome = process.env.HOME;
    const originalDisableKeytar = process.env.ODEN_DISABLE_KEYTAR;
    const originalMemoryURL = process.env.MEMORY_API_URL;
    const temporaryHome = await mkdtemp(join(tmpdir(), "oden-memory-config-"));
    process.env.HOME = temporaryHome;
    process.env.ODEN_DISABLE_KEYTAR = "1";
    delete process.env.MEMORY_API_URL;
    let requestedURL = "";
    try {
      await ConfigManager.set("MEMORY_API_URL", "https://memory.example/v1");
      const tools = createMemoryTools({
        getBaseURL: async (): Promise<string | undefined> => {
          if (!(await ConfigManager.has("MEMORY_API_URL"))) {
            return undefined;
          }
          return ConfigManager.get("MEMORY_API_URL");
        },
        resolve: async (): Promise<readonly string[]> => ["8.8.8.8"],
        fetch: async (input: RequestInfo | URL): Promise<Response> => {
          requestedURL = input.toString();
          return new Response("{}", { status: 201 });
        },
      });
      expect(await tools.saveMemoryTool.execute({ key: "editor", value: "prefers tabs" })).toContain("Memory saved");
      expect(requestedURL).toBe("https://memory.example/v1/memories");
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalDisableKeytar === undefined) {
        delete process.env.ODEN_DISABLE_KEYTAR;
      } else {
        process.env.ODEN_DISABLE_KEYTAR = originalDisableKeytar;
      }
      if (originalMemoryURL === undefined) {
        delete process.env.MEMORY_API_URL;
      } else {
        process.env.MEMORY_API_URL = originalMemoryURL;
      }
      await rm(temporaryHome, { recursive: true, force: true });
    }
  });
});
