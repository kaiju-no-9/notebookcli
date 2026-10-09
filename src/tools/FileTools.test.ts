import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { getProjectTreeTool, registerFileTools } from "./FileTools.js";
import { ToolRegistry } from "./ToolRegistry.js";

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "oden-file-tools-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("FileTools", (): void => {
  it("lists directory structure and excludes node_modules", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory: string): Promise<void> => {
      await mkdir(path.join(directory, "src"));
      await mkdir(path.join(directory, "node_modules", "hidden"), { recursive: true });
      await writeFile(path.join(directory, "src", "index.ts"), "", "utf8");
      await writeFile(path.join(directory, "node_modules", "hidden", "dep.js"), "", "utf8");
      const tree = await getProjectTreeTool.execute({ directory });
      expect(tree).toContain("src/");
      expect(tree).toContain("index.ts");
      expect(tree).not.toContain("node_modules");
      expect(tree).not.toContain("dep.js");
    });
  });

  it("respects maxDepth", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory: string): Promise<void> => {
      await mkdir(path.join(directory, "one", "two"), { recursive: true });
      await writeFile(path.join(directory, "one", "two", "deep.txt"), "", "utf8");
      const tree = await getProjectTreeTool.execute({ directory, maxDepth: 1 });
      expect(tree).toContain("one/");
      expect(tree).not.toContain("two/");
    });
  });

  it("returns errors as strings and registers the tool", async (): Promise<void> => {
    const result = await getProjectTreeTool.execute({ directory: "/path/that/does/not/exist" });
    expect(result).toContain("Error listing project tree:");
    const registry = new ToolRegistry();
    registerFileTools(registry);
    expect(registry.get("get_project_tree")).toBe(getProjectTreeTool);
  });
});
