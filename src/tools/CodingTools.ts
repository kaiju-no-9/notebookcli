import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";
import { WorkspaceContext } from "../utils/WorkspaceContext.js";
import { createApprovalRequest } from "./Approval.js";

const codingContextParameters = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
}).refine((value): boolean => value.startLine === undefined || value.endLine === undefined || value.startLine <= value.endLine, {
  message: "startLine must be less than or equal to endLine",
});

const codeParameters = z.object({
  filePath: z.string().min(1),
  content: z.string(),
  description: z.string().optional(),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createCodingContextTool(workspace: WorkspaceContext): ToolDefinition {
  return {
  name: "coding_context_tool",
  description: "Read a file, optionally selecting a line range. Lines are numbered in the result.",
  parameters: codingContextParameters,
  execute: async (args: unknown): Promise<string> => {
    try {
      const { filePath, startLine, endLine } = codingContextParameters.parse(args);
      const resolvedPath = await workspace.resolve(filePath, "read");
      const content = await readFile(resolvedPath, "utf8");
      const lines = content.split(/\r?\n/);
      const firstLine = startLine ?? 1;
      const lastLine = endLine ?? lines.length;
      if (firstLine > lines.length || lastLine > lines.length) {
        return `Error reading ${filePath}: line range is outside the file (1-${lines.length})`;
      }
      return lines
        .slice(firstLine - 1, lastLine)
        .map((line: string, index: number): string => `${firstLine + index} | ${line}`)
        .join("\n");
    } catch (error: unknown) {
      return `Error reading file: ${errorMessage(error)}`;
    }
  },
  };
}

function createCodeTool(workspace: WorkspaceContext): ToolDefinition {
  return {
  name: "code_tool",
  description: "Create or update a file with the supplied content.",
  parameters: codeParameters,
  execute: async (args: unknown, context): Promise<string> => {
    try {
      const { filePath, content } = codeParameters.parse(args);
      const resolvedPath = await workspace.resolve(filePath, "write");
      let exists = false;
      let originalTarget: { dev: number; ino: number; size: number; mtimeMs: number } | undefined;
      try {
        const metadata = await lstat(resolvedPath);
        if (metadata.isSymbolicLink()) return `File write denied: symbolic link targets require manual resolution. ${resolvedPath} was not changed.`;
        exists = true;
        originalTarget = { dev: metadata.dev, ino: metadata.ino, size: metadata.size, mtimeMs: metadata.mtimeMs };
      }
      catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      if (exists || workspace.isSensitive(resolvedPath)) {
        if (context?.approvalService === undefined) return `File write denied: approval is unavailable. ${resolvedPath} was not changed.`;
        const originalContent = exists ? await readFile(resolvedPath, "utf8") : "";
        const request = createApprovalRequest({
          runId: context.runId,
          category: "file_write",
          risk: workspace.isSensitive(resolvedPath) ? "high" : "moderate",
          action: JSON.stringify({ operation: "write_file", path: resolvedPath, content }),
          summary: `${exists ? "Replace existing file" : "Create sensitive file"} · ${content.split(/\r?\n/).length} lines · ${Buffer.byteLength(content, "utf8")} bytes`,
          preview: createFileDiff(resolvedPath, originalContent, content),
          target: resolvedPath,
          workspaceRoot: workspace.root,
          reason: workspace.isSensitive(resolvedPath) ? "Writing a sensitive file requires explicit approval" : "Overwriting an existing file requires explicit approval",
        });
        const decision = await context.approvalService.requestApproval(request);
        if (decision.status !== "approved") return `File write ${decision.status}: ${decision.reason ?? "Write was not approved."} ${resolvedPath} was not changed.`;
        const revalidatedPath = await workspace.resolve(filePath, "write");
        if (revalidatedPath !== resolvedPath) return `File write denied: the target changed while awaiting approval. ${resolvedPath} was not changed.`;
        try {
          const latest = await lstat(resolvedPath);
          if (latest.isSymbolicLink() || originalTarget === undefined || latest.dev !== originalTarget.dev || latest.ino !== originalTarget.ino || latest.size !== originalTarget.size || latest.mtimeMs !== originalTarget.mtimeMs) {
            return `File write denied: the target changed while awaiting approval. ${resolvedPath} was not changed.`;
          }
        } catch (error: unknown) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT") || originalTarget !== undefined) throw error;
        }
      }
      const parentDirectory = path.dirname(resolvedPath);
      if (parentDirectory !== ".") {
        await mkdir(parentDirectory, { recursive: true });
      }
      await writeFile(resolvedPath, content, "utf8");
      return `Created/Updated ${resolvedPath} (${Buffer.byteLength(content, "utf8")} bytes)`;
    } catch (error: unknown) {
      return `Error writing file: ${errorMessage(error)}`;
    }
  },
  };
}

function createFileDiff(filePath: string, originalContent: string, proposedContent: string): string {
  const original = originalContent.length === 0 ? [] : originalContent.split(/\r?\n/);
  const proposed = proposedContent.length === 0 ? [] : proposedContent.split(/\r?\n/);
  let prefix = 0;
  while (prefix < original.length && prefix < proposed.length && original[prefix] === proposed[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < original.length - prefix
    && suffix < proposed.length - prefix
    && original[original.length - suffix - 1] === proposed[proposed.length - suffix - 1]
  ) suffix += 1;

  const contextStart = Math.max(0, prefix - 3);
  const oldEnd = Math.min(original.length, original.length - suffix + 3);
  const newEnd = Math.min(proposed.length, proposed.length - suffix + 3);
  const diffLines = [
    `--- a/${path.basename(filePath)}`,
    `+++ b/${path.basename(filePath)}`,
    `@@ -${contextStart + 1},${oldEnd - contextStart} +${contextStart + 1},${newEnd - contextStart} @@`,
    ...original.slice(contextStart, prefix).map((line): string => ` ${line}`),
    ...original.slice(prefix, original.length - suffix).map((line): string => `-${line}`),
    ...proposed.slice(prefix, proposed.length - suffix).map((line): string => `+${line}`),
    ...(suffix > 0 ? original.slice(original.length - suffix, oldEnd).map((line): string => ` ${line}`) : []),
  ];
  const maximumLines = 120;
  if (diffLines.length > maximumLines) {
    return `${diffLines.slice(0, maximumLines).join("\n")}\n… diff truncated; review the exact action for full content.`;
  }
  return diffLines.join("\n");
}

const defaultWorkspace = new WorkspaceContext();
export const codingContextTool: ToolDefinition = createCodingContextTool(defaultWorkspace);
export const codeTool: ToolDefinition = createCodeTool(defaultWorkspace);

export function registerCodingTools(registry: ToolRegistry, workspace: WorkspaceContext = defaultWorkspace): void {
  registerCodingReadTools(registry, workspace);
  registry.register(createCodeTool(workspace));
}

export function registerCodingReadTools(registry: ToolRegistry, workspace: WorkspaceContext = defaultWorkspace): void {
  registry.register(createCodingContextTool(workspace));
}
