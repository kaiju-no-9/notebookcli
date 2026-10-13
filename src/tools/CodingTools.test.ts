import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { registerCodingTools } from "./CodingTools.js";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";
import { WorkspaceContext } from "../utils/WorkspaceContext.js";

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "oden-coding-tools-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function codingTools(directory: string): { context: ToolDefinition; code: ToolDefinition } {
  const registry = new ToolRegistry();
  registerCodingTools(registry, new WorkspaceContext(directory));
  const context = registry.get("coding_context_tool");
  const code = registry.get("code_tool");
  if (context === undefined || code === undefined) throw new Error("Coding tools were not registered");
  return { context, code };
}

describe("CodingTools", (): void => {
  it("reads an existing file and numbers each line", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      await writeFile(path.join(directory, "sample.ts"), "first\nsecond", "utf8");
      expect(await codingTools(directory).context.execute({ filePath: "sample.ts" })).toBe("1 | first\n2 | second");
    });
  });

  it("returns only the requested line range", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      await writeFile(path.join(directory, "sample.ts"), "first\nsecond\nthird", "utf8");
      expect(await codingTools(directory).context.execute({ filePath: "sample.ts", startLine: 2, endLine: 2 })).toBe("2 | second");
    });
  });

  it("returns errors for missing files and invalid ranges", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      const tools = codingTools(directory);
      expect(await tools.context.execute({ filePath: "missing.ts" })).toContain("Error reading file:");
      await writeFile(path.join(directory, "sample.ts"), "only one line", "utf8");
      expect(await tools.context.execute({ filePath: "sample.ts", startLine: 3 })).toContain("line range is outside the file");
    });
  });

  it("creates files and parent directories and reports UTF-8 byte size", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      const confirmation = await codingTools(directory).code.execute({ filePath: "nested/source.ts", content: "café" });
      expect(confirmation).toBe(`Created/Updated ${path.join(new WorkspaceContext(directory).root, "nested/source.ts")} (5 bytes)`);
      expect(await readFile(path.join(directory, "nested/source.ts"), "utf8")).toBe("café");
    });
  });

  it("overwrites existing files and returns validation errors as strings", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      await writeFile(path.join(directory, "existing.ts"), "old", "utf8");
      const tools = codingTools(directory);
      const denied = await tools.code.execute({ filePath: "existing.ts", content: "new" });
      expect(denied).toContain("approval is unavailable");
      expect(await readFile(path.join(directory, "existing.ts"), "utf8")).toBe("old");
      expect(await tools.code.execute({ filePath: "", content: "x" })).toContain("Error writing file:");
    });
  });

  it("writes an overwrite only after approving the exact immutable payload", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      await writeFile(path.join(directory, "existing.ts"), "old", "utf8");
      const tools = codingTools(directory);
      let action = "";
      const approvalService = { requestApproval: async (request: { readonly action: string }): Promise<{ status: "approved" }> => {
        action = request.action;
        return { status: "approved" };
      } };
      const content = "new content";
      const result = await tools.code.execute({ filePath: "existing.ts", content }, { runId: "run-test", approvalService });
      expect(action).toContain(content);
      expect(result).toContain("Updated");
      expect(await readFile(path.join(directory, "existing.ts"), "utf8")).toBe(content);
    });
  });

  it("does not change an existing file when approval is denied", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      await writeFile(path.join(directory, "existing.ts"), "original", "utf8");
      const tools = codingTools(directory);
      const result = await tools.code.execute({ filePath: "existing.ts", content: "replacement" }, {
        runId: "run-test",
        approvalService: { requestApproval: async (): Promise<{ status: "denied" }> => ({ status: "denied" }) },
      });
      expect(result).toContain("File write denied");
      expect(await readFile(path.join(directory, "existing.ts"), "utf8")).toBe("original");
    });
  });

  it("registers both tools with the registry", (): void => {
    const registry = new ToolRegistry();
    registerCodingTools(registry);
    expect(registry.getNames()).toEqual(["coding_context_tool", "code_tool"]);
  });
});
