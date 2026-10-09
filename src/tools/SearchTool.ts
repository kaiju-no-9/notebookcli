import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { ConfigManager } from "../config/ConfigManager.js";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";

export interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export type HttpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface TavilySearchClient {
  search(query: string, options?: { maxResults?: number; searchDepth?: "basic" }): Promise<{
    results?: Array<{ title?: string; url?: string; content?: string }>;
  }>;
}

export interface SearchDependencies {
  readonly getApiKey: () => Promise<string | undefined>;
  readonly getGitHubToken?: () => Promise<string | undefined>;
  readonly createTavilyClient: (apiKey: string) => Promise<TavilySearchClient>;
  readonly fetch: HttpFetch;
  readonly resolve: (hostname: string) => Promise<readonly string[]>;
}

const searchParameters = z.object({ query: z.string().trim().min(1).max(2_000) });
const MAX_RESULTS = 5;

function ipv4ToNumber(address: string): number {
  return address.split(".").reduce((result: number, part: string): number => ((result << 8) | Number(part)) >>> 0, 0);
}

function inIPv4Range(address: string, network: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask);
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0] ?? address.toLowerCase();
  const version = isIP(normalized);
  if (version === 4) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
      ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([network, bits]: (string | number)[]): boolean => inIPv4Range(normalized, network as string, bits as number));
  }
  if (version === 6) {
    if (normalized === "::" || normalized === "::1" || /^f[cd]/.test(normalized) || /^fe[89ab]/.test(normalized) || /^ff/.test(normalized)) {
      return true;
    }
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice(7);
      return isIP(mapped) === 4 ? isPrivateAddress(mapped) : true;
    }
    return false;
  }
  return true;
}

export async function isPrivateIP(hostname: string, resolve: SearchDependencies["resolve"] = async (host: string): Promise<readonly string[]> =>
  (await lookup(host, { all: true, verbatim: true })).map((entry): string => entry.address),
): Promise<boolean> {
  const candidate = hostname.replace(/^\[|\]$/g, "");
  if (isIP(candidate) !== 0) {
    return isPrivateAddress(candidate);
  }
  if (candidate.toLowerCase() === "localhost" || candidate.toLowerCase().endsWith(".localhost")) {
    return true;
  }
  try {
    const addresses = await resolve(candidate);
    return addresses.length === 0 || addresses.some(isPrivateAddress);
  } catch {
    return true;
  }
}

export async function assertPublicURL(url: URL, dependencies: Pick<SearchDependencies, "resolve">): Promise<void> {
  if (url.protocol !== "https:" || await isPrivateIP(url.hostname, dependencies.resolve)) {
    throw new Error("Request blocked because its destination is not a public HTTPS host");
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match: string, code: string): string => String.fromCodePoint(Number(code)));
}

function formatResults(results: readonly SearchResult[]): string {
  if (results.length === 0) {
    return "No search results found.";
  }
  return results.slice(0, MAX_RESULTS).map((result, index): string =>
    `${index + 1}. ${result.title}\n   ${result.url}\n   ${result.snippet}`,
  ).join("\n");
}

export async function fetchPublic(url: URL, dependencies: Pick<SearchDependencies, "fetch" | "resolve">, init?: RequestInit): Promise<Response> {
  await assertPublicURL(url, dependencies);
  const requestOptions: RequestInit = { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000), redirect: "manual" };
  const response = await dependencies.fetch(url, requestOptions);
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location === null) {
      throw new Error(`Search endpoint returned redirect status ${response.status} without a location`);
    }
    const redirectURL = new URL(location, url);
    await assertPublicURL(redirectURL, dependencies);
    return dependencies.fetch(redirectURL, { ...requestOptions, redirect: "manual" });
  }
  return response;
}

async function tavilyResults(query: string, apiKey: string, dependencies: SearchDependencies): Promise<SearchResult[]> {
  const apiURL = new URL("https://api.tavily.com/");
  await assertPublicURL(apiURL, dependencies);
  const client = await dependencies.createTavilyClient(apiKey);
  const response = await client.search(query, { maxResults: MAX_RESULTS, searchDepth: "basic" });
  return (response.results ?? []).map((result): SearchResult => ({
    title: result.title ?? "Untitled result",
    url: result.url ?? "",
    snippet: result.content ?? "",
  }));
}

async function githubResults(query: string, dependencies: SearchDependencies, token?: string): Promise<SearchResult[]> {
  const repoMatch = query.match(/\brepo:([\w.-]+\/[\w.-]+)\b/i);
  const isCodeQuery = repoMatch !== null || /\b(?:code|repository|repo|language):\S+/i.test(query);
  if (!isCodeQuery) {
    return [];
  }
  const endpoint = repoMatch === null ? "repositories" : "code";
  const url = new URL(`https://api.github.com/search/${endpoint}`);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(MAX_RESULTS));
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "Oden-Agent" };
  if (token !== undefined && token.length > 0) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetchPublic(url, dependencies, { headers });
  if (!response.ok) {
    throw new Error(`GitHub search returned HTTP ${response.status}`);
  }
  const parsed: unknown = await response.json();
  const schema = z.object({ items: z.array(z.object({
    name: z.string().optional(),
    full_name: z.string().optional(),
    html_url: z.string().url(),
    description: z.string().nullable().optional(),
    path: z.string().optional(),
    text_matches: z.array(z.object({ fragment: z.string() })).optional(),
  })).default([]) });
  const data = schema.parse(parsed);
  return data.items.map((item): SearchResult => ({
    title: item.full_name ?? item.name ?? item.path ?? "GitHub result",
    url: item.html_url,
    snippet: item.description ?? item.text_matches?.map((match): string => match.fragment).join(" ") ?? "",
  }));
}

async function duckDuckGoResults(query: string, dependencies: SearchDependencies): Promise<SearchResult[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetchPublic(url, dependencies, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Oden/1.0; +https://github.com/kaiju-no-9/notebookcli)" },
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo search returned HTTP ${response.status}`);
  }
  const html = await response.text();
  const results: SearchResult[] = [];
  const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>)/gi;
  let match: RegExpExecArray | null = resultPattern.exec(html);
  while (match !== null && results.length < MAX_RESULTS) {
    const target = decodeHtml(match[1] ?? "");
    const title = decodeHtml((match[2] ?? "").replace(/<[^>]*>/g, "").trim());
    const snippet = decodeHtml((match[3] ?? match[4] ?? "").replace(/<[^>]*>/g, "").trim());
    let resultURL: URL;
    try {
      resultURL = new URL(target, url);
      if (resultURL.hostname.endsWith("duckduckgo.com")) {
        const redirectTarget = resultURL.searchParams.get("uddg");
        if (redirectTarget === null) {
          match = resultPattern.exec(html);
          continue;
        }
        resultURL = new URL(redirectTarget);
      }
      if (resultURL.protocol === "https:") {
        results.push({ title, url: resultURL.toString(), snippet });
      }
    } catch {
      // Ignore malformed search result links.
    }
    match = resultPattern.exec(html);
  }
  return results;
}

function createDefaultDependencies(): SearchDependencies {
  return {
    getApiKey: async (): Promise<string | undefined> => {
      if (!(await ConfigManager.has("TAVILY_API_KEY"))) {
        return undefined;
      }
      return ConfigManager.get("TAVILY_API_KEY");
    },
    getGitHubToken: async (): Promise<string | undefined> => {
      if (!(await ConfigManager.has("GITHUB_TOKEN"))) {
        return undefined;
      }
      return ConfigManager.get("GITHUB_TOKEN");
    },
    createTavilyClient: async (apiKey: string): Promise<TavilySearchClient> => {
      const { tavily } = await import("@tavily/core");
      return tavily({ apiKey });
    },
    fetch,
    resolve: async (hostname: string): Promise<readonly string[]> =>
      (await lookup(hostname, { all: true, verbatim: true })).map((entry): string => entry.address),
  };
}

export function createSearchTool(dependencies: SearchDependencies = createDefaultDependencies()): ToolDefinition {
  return {
    name: "search",
    description: "Search the web. Use this tool for external research and current information.",
    parameters: searchParameters,
    execute: async (args: unknown): Promise<string> => {
      try {
        const { query } = searchParameters.parse(args);
        const failures: string[] = [];
        const apiKey = await dependencies.getApiKey().catch((): undefined => undefined);
        if (apiKey !== undefined && apiKey.length > 0) {
          try {
            const results = await tavilyResults(query, apiKey, dependencies);
            if (results.length > 0) {
              return formatResults(results);
            }
          } catch (error: unknown) {
            failures.push(`Tavily: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        try {
          const githubToken = await dependencies.getGitHubToken?.().catch((): undefined => undefined);
          const results = await githubResults(query, dependencies, githubToken);
          if (results.length > 0) {
            return formatResults(results);
          }
        } catch (error: unknown) {
          failures.push(`GitHub: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          const results = await duckDuckGoResults(query, dependencies);
          if (results.length > 0) {
            return formatResults(results);
          }
        } catch (error: unknown) {
          failures.push(`DuckDuckGo: ${error instanceof Error ? error.message : String(error)}`);
        }
        return `Search failed: all available search providers returned no results${failures.length === 0 ? "" : ` (${failures.join("; ")})`}`;
      } catch (error: unknown) {
        return `Search failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

export const searchTool: ToolDefinition = createSearchTool();

export function registerSearchTools(registry: ToolRegistry): void {
  registry.register(searchTool);
}
