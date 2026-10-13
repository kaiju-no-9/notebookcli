import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { registerFileTools } from "./FileTools.js";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";
import { WorkspaceContext } from "../utils/WorkspaceContext.js";

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "oden-file-tools-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function treeTool(root: string): ToolDefinition {
  const registry = new ToolRegistry();
  registerFileTools(registry, new WorkspaceContext(root));
  const tool = registry.get("get_project_tree");
  if (tool === undefined) throw new Error("File tool was not registered");
  return tool;
}

describe("FileTools", (): void => {
  it("lists the selected workspace while excluding generated and sensitive entries", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      await mkdir(path.join(directory, "src"));
      await mkdir(path.join(directory, "node_modules", "hidden"), { recursive: true });
      await writeFile(path.join(directory, "src", "index.ts"), "", "utf8");
      await writeFile(path.join(directory, "node_modules", "hidden", "dep.js"), "", "utf8");
      await writeFile(path.join(directory, ".env"), "secret", "utf8");
      const tree = await treeTool(directory).execute({ directory: "." });
      expect(tree).toContain("src/");
      expect(tree).toContain("index.ts");
      expect(tree).not.toContain("node_modules");
      expect(tree).not.toContain("dep.js");
      expect(tree).not.toContain(".env");
    });
  });

  it("respects maxDepth", async (): Promise<void> => {
    await withTemporaryDirectory(async (directory): Promise<void> => {
      await mkdir(path.join(directory, "one", "two"), { recursive: true });
      await writeFile(path.join(directory, "one", "two", "deep.txt"), "", "utf8");
      const tree = await treeTool(directory).execute({ directory: ".", maxDepth: 1 });
      expect(tree).toContain("one/");
      expect(tree).not.toContain("two/");
    });
  });

  it("returns errors as strings and registers the tool", async (): Promise<void> => {
    const registry = new ToolRegistry();
    registerFileTools(registry);
    expect(registry.get("get_project_tree")).toBeDefined();
    await withTemporaryDirectory(async (directory): Promise<void> => {
      const result = await treeTool(directory).execute({ directory: "missing" });
      expect(result).toContain("Error listing project tree:");
    });
  });
});
