import { z } from "zod";
import { MemorySearchRules } from "./MemorySearchRules.js";
import { fetchPublic, type HttpFetch, type SearchDependencies } from "./SearchTool.js";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";

export interface MemoryDependencies {
  readonly getBaseURL: () => string | undefined;
  readonly fetch: HttpFetch;
  readonly resolve: SearchDependencies["resolve"];
}

const saveMemoryParameters = z.object({ key: z.string().trim().min(1).max(200), value: z.string().trim().min(1).max(10_000) });
const searchMemoryParameters = z.object({ query: z.string().trim().min(1).max(2_000) });

function baseURL(dependencies: MemoryDependencies): URL {
  const value = dependencies.getBaseURL();
  if (value === undefined || value.trim().length === 0) {
    throw new Error("MEMORY_API_URL is not configured");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    throw new Error("MEMORY_API_URL must be an HTTPS URL without embedded credentials");
  }
  return url;
}

function endpoint(root: URL, suffix: string): URL {
  const path = root.pathname.endsWith("/") ? root.pathname : `${root.pathname}/`;
  root.pathname = `${path}${suffix}`.replace(/\/{2,}/g, "/");
  return root;
}

export function createMemoryTools(dependencies: MemoryDependencies = {
  getBaseURL: (): string | undefined => process.env.MEMORY_API_URL,
  fetch,
  resolve: async (hostname: string): Promise<readonly string[]> =>
    (await import("node:dns/promises")).lookup(hostname, { all: true, verbatim: true }).then((entries): string[] => entries.map((entry): string => entry.address)),
}): { readonly saveMemoryTool: ToolDefinition; readonly searchMemoryTool: ToolDefinition } {
  const saveMemoryTool: ToolDefinition = {
    name: "save_memory",
    description: "Save a user preference or fact only when the user explicitly asks you to remember it. Never store passwords, API keys, or tokens.",
    parameters: saveMemoryParameters,
    execute: async (args: unknown): Promise<string> => {
      try {
        const { key, value } = saveMemoryParameters.parse(args);
        const rule = MemorySearchRules.validateMemory(key, value);
        if (!rule.allowed) {
          return `Memory not saved: ${rule.reason}`;
        }
        const url = endpoint(baseURL(dependencies), "memories");
        const result = await fetchPublic(url, {
          fetch: dependencies.fetch,
          resolve: dependencies.resolve,
        }, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ key, value }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!result.ok) {
          return `Memory save failed: memory service returned HTTP ${result.status}`;
        }
        return `Memory saved for key '${key}'.`;
      } catch (error: unknown) {
        return `Memory save failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };

  const searchMemoryTool: ToolDefinition = {
    name: "search_memory",
    description: "Search user memories by a relevant preference or context query. Do not search for credentials.",
    parameters: searchMemoryParameters,
    execute: async (args: unknown): Promise<string> => {
      try {
        const { query } = searchMemoryParameters.parse(args);
        const rule = MemorySearchRules.validateQuery(query);
        if (!rule.allowed) {
          return `Memory search rejected: ${rule.reason}`;
        }
        const url = endpoint(baseURL(dependencies), "memories/search");
        url.searchParams.set("q", query);
        const result = await fetchPublic(url, {
          fetch: dependencies.fetch,
          resolve: dependencies.resolve,
        }, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!result.ok) {
          return `Memory search failed: memory service returned HTTP ${result.status}`;
        }
        const payload: unknown = await result.json();
        const response = z.unknown().parse(payload);
        return `Matching memories:\n${JSON.stringify(response, null, 2)}`;
      } catch (error: unknown) {
        return `Memory search failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
  return { saveMemoryTool, searchMemoryTool };
}

const memoryTools = createMemoryTools();
export const saveMemoryTool = memoryTools.saveMemoryTool;
export const searchMemoryTool = memoryTools.searchMemoryTool;

export function registerMemoryTools(registry: ToolRegistry): void {
  registry.register(saveMemoryTool);
  registry.register(searchMemoryTool);
}
