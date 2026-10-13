import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";
import { WorkspaceContext } from "../utils/WorkspaceContext.js";

const EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "__pycache__", ".next"]);
const projectTreeParameters = z.object({
  directory: z.string().default("."),
  maxDepth: z.number().int().nonnegative().default(3),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function appendDirectory(
  workspace: WorkspaceContext,
  absoluteDirectory: string,
  currentDepth: number,
  maxDepth: number,
  lines: string[],
): Promise<void> {
  if (currentDepth >= maxDepth) {
    return;
  }
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  entries.sort((left, right): number => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink() || workspace.isSensitive(entry.name)) continue;
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const prefix = "  ".repeat(currentDepth);
    const suffix = entry.isDirectory() ? "/" : "";
    lines.push(`${prefix}${entry.name}${suffix}`);
    if (entry.isDirectory()) {
      await appendDirectory(workspace, path.join(absoluteDirectory, entry.name), currentDepth + 1, maxDepth, lines);
    }
  }
}

function createProjectTreeTool(workspace: WorkspaceContext): ToolDefinition {
  return {
  name: "get_project_tree",
  description: "List a directory tree, excluding generated and dependency directories.",
  parameters: projectTreeParameters,
  execute: async (args: unknown): Promise<string> => {
    try {
      const { directory, maxDepth } = projectTreeParameters.parse(args ?? {});
      const resolvedDirectory = await workspace.resolve(directory, "directory");
      const lines = [directory];
      await appendDirectory(workspace, resolvedDirectory, 0, maxDepth, lines);
      return lines.join("\n");
    } catch (error: unknown) {
      return `Error listing project tree: ${errorMessage(error)}`;
    }
  },
  };
}

const defaultWorkspace = new WorkspaceContext();
export const getProjectTreeTool: ToolDefinition = createProjectTreeTool(defaultWorkspace);

export function registerFileTools(registry: ToolRegistry, workspace: WorkspaceContext = defaultWorkspace): void {
  registry.register(createProjectTreeTool(workspace));
}
