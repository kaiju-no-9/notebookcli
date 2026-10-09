import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { codeTool, codingContextTool, registerCodingTools } from "./CodingTools.js";
import { ToolRegistry } from "./ToolRegistry.js";

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "oden-coding-tools-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("CodingTools", (): void => {
  it("reads an existing file and numbers each line", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory: string): Promise<void> => {
      const filePath = path.join(directory, "sample.ts");
      await writeFile(filePath, "first\nsecond", "utf8");
      expect(await codingContextTool.execute({ filePath })).toBe("1 | first\n2 | second");
    });
  });

  it("returns only the requested line range", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory: string): Promise<void> => {
      const filePath = path.join(directory, "sample.ts");
      await writeFile(filePath, "first\nsecond\nthird", "utf8");
      expect(await codingContextTool.execute({ filePath, startLine: 2, endLine: 2 })).toBe("2 | second");
    });
  });

  it("returns an error string for missing files and invalid ranges", async (): Promise<void> => {
    const missing = await codingContextTool.execute({ filePath: "/path/that/does/not/exist" });
    expect(missing).toContain("Error reading file:");
    await withTemporaryDirectory(async (directory: string): Promise<void> => {
      const filePath = path.join(directory, "sample.ts");
      await writeFile(filePath, "only one line", "utf8");
      expect(await codingContextTool.execute({ filePath, startLine: 3 })).toContain("line range is outside the file");
    });
  });

  it("creates files and parent directories and reports UTF-8 byte size", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory: string): Promise<void> => {
      const filePath = path.join(directory, "nested", "source.ts");
      const confirmation = await codeTool.execute({ filePath, content: "café" });
      expect(confirmation).toBe(`Created/Updated ${filePath} (5 bytes)`);
      expect(await readFile(filePath, "utf8")).toBe("café");
    });
  });

  it("overwrites an existing file and returns errors as strings", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory: string): Promise<void> => {
      const filePath = path.join(directory, "existing.ts");
      await writeFile(filePath, "old", "utf8");
      await codeTool.execute({ filePath, content: "new" });
      expect(await readFile(filePath, "utf8")).toBe("new");
    });
    expect(await codeTool.execute({ filePath: "" as unknown, content: "x" })).toContain("Error writing file:");
  });

  it("registers both tools with the registry", (): void => {
    const registry = new ToolRegistry();
    registerCodingTools(registry);
    expect(registry.getNames()).toEqual(["coding_context_tool", "code_tool"]);
  });
});
