import { describe, expect, it } from "bun:test";
import { createSearchTool, isPrivateIP, type SearchDependencies } from "./SearchTool.js";

function dependencies(overrides: Partial<SearchDependencies> = {}): SearchDependencies {
  return {
    getApiKey: async (): Promise<string | undefined> => undefined,
    createTavilyClient: async (): Promise<{ search: () => Promise<{ results: [] }> }> => ({
      search: async (): Promise<{ results: [] }> => ({ results: [] }),
    }),
    fetch: async (): Promise<Response> => new Response("", { status: 200 }),
    resolve: async (): Promise<readonly string[]> => ["8.8.8.8"],
    ...overrides,
  };
}

describe("SearchTool", (): void => {
  it("calls Tavily when a configured API key is available", async (): Promise<void> => {
    let receivedKey = "";
    const tool = createSearchTool(dependencies({
      getApiKey: async (): Promise<string> => "tavily-test-key",
      createTavilyClient: async (key: string): Promise<{ search: () => Promise<{ results: Array<{ title: string; url: string; content: string }> }> }> => {
        receivedKey = key;
        return { search: async () => ({ results: [{ title: "Docs", url: "https://example.com", content: "Useful page" }] }) };
      },
    }));
    const result = await tool.execute({ query: "TypeScript docs" });
    expect(receivedKey).toBe("tavily-test-key");
    expect(result).toContain("Docs");
    expect(result).toContain("Useful page");
  });

  it("falls back to DuckDuckGo when Tavily is unavailable", async (): Promise<void> => {
    const tool = createSearchTool(dependencies({
      getApiKey: async (): Promise<string> => "configured",
      createTavilyClient: async (): Promise<never> => { throw new Error("Tavily unavailable"); },
      fetch: async (input: RequestInfo | URL): Promise<Response> => {
        const url = new URL(input.toString());
        expect(url.hostname).toBe("html.duckduckgo.com");
        return new Response('<a class="result__a" href="https://example.com/page">Example</a><a class="result__snippet">Relevant snippet</a>');
      },
    }));
    const result = await tool.execute({ query: "general research" });
    expect(result).toContain("Example");
    expect(result).toContain("Relevant snippet");
  });

  it("gracefully uses DuckDuckGo when no Tavily key is configured", async (): Promise<void> => {
    let called = false;
    const tool = createSearchTool(dependencies({
      getApiKey: async (): Promise<undefined> => undefined,
      fetch: async (): Promise<Response> => {
        called = true;
        return new Response("no matching result markup");
      },
    }));
    const result = await tool.execute({ query: "current weather in Paris" });
    expect(called).toBe(true);
    expect(result).toContain("Search failed: all available search providers");
    expect(result).not.toContain("Tavily:");
  });

  it("uses GitHub search for repository queries", async (): Promise<void> => {
    let calledURL = "";
    const tool = createSearchTool(dependencies({
      fetch: async (input: RequestInfo | URL): Promise<Response> => {
        calledURL = input.toString();
        return Response.json({ items: [{ full_name: "owner/project", html_url: "https://github.com/owner/project", description: "Project result" }] });
      },
    }));
    const result = await tool.execute({ query: "repo:owner/project" });
    expect(calledURL).toContain("api.github.com/search/code");
    expect(result).toContain("owner/project");
  });

  it("returns a descriptive error when every available tier fails", async (): Promise<void> => {
    const tool = createSearchTool(dependencies({
      getApiKey: async (): Promise<string> => "configured",
      createTavilyClient: async (): Promise<never> => { throw new Error("no API"); },
      fetch: async (): Promise<Response> => new Response("unavailable", { status: 503 }),
    }));
    const result = await tool.execute({ query: "repo:owner/project issue" });
    expect(result).toContain("Search failed: all available search providers");
    expect(result).toContain("Tavily:");
    expect(result).toContain("DuckDuckGo:");
  });

  it("blocks resolved private IPs and permits public addresses", async (): Promise<void> => {
    expect(await isPrivateIP("127.0.0.1")).toBe(true);
    expect(await isPrivateIP("10.0.0.1")).toBe(true);
    expect(await isPrivateIP("8.8.8.8")).toBe(false);
    expect(await isPrivateIP("internal.example", async (): Promise<readonly string[]> => ["192.168.1.3"])).toBe(true);
    expect(await isPrivateIP("public.example", async (): Promise<readonly string[]> => ["8.8.8.8"])).toBe(false);
  });
});
