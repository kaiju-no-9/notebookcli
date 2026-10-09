import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";

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

export const codingContextTool: ToolDefinition = {
  name: "coding_context_tool",
  description: "Read a file, optionally selecting a line range. Lines are numbered in the result.",
  parameters: codingContextParameters,
  execute: async (args: unknown): Promise<string> => {
    try {
      const { filePath, startLine, endLine } = codingContextParameters.parse(args);
      const content = await readFile(filePath, "utf8");
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

export const codeTool: ToolDefinition = {
  name: "code_tool",
  description: "Create or update a file with the supplied content.",
  parameters: codeParameters,
  execute: async (args: unknown): Promise<string> => {
    try {
      const { filePath, content } = codeParameters.parse(args);
      const parentDirectory = path.dirname(filePath);
      if (parentDirectory !== ".") {
        await mkdir(parentDirectory, { recursive: true });
      }
      await writeFile(filePath, content, "utf8");
      return `Created/Updated ${filePath} (${Buffer.byteLength(content, "utf8")} bytes)`;
    } catch (error: unknown) {
      return `Error writing file: ${errorMessage(error)}`;
    }
  },
};

export function registerCodingTools(registry: ToolRegistry): void {
  registry.register(codingContextTool);
  registry.register(codeTool);
}
