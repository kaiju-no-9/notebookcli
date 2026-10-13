import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { WorkspaceContext } from "./WorkspaceContext.js";

async function withDirectories(run: (root: string, outside: string) => Promise<void>): Promise<void> {
  const base = await mkdtemp(path.join(os.tmpdir(), "oden-workspace-"));
  const root = path.join(base, "project");
  const outside = path.join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  try { await run(root, outside); } finally { await rm(base, { recursive: true, force: true }); }
}

describe("WorkspaceContext", (): void => {
  it("canonicalizes the root and resolves relative and in-root absolute paths", async (): Promise<void> => {
    await withDirectories(async (root): Promise<void> => {
      await writeFile(path.join(root, "app.ts"), "ok", "utf8");
      const workspace = new WorkspaceContext(root);
      expect(workspace.root).toBe(await realpath(root));
      expect(await workspace.resolve("app.ts")).toBe(path.join(workspace.root, "app.ts"));
      expect(await workspace.resolve(path.join(root, "app.ts"))).toBe(path.join(workspace.root, "app.ts"));
    });
  });

  it("rejects traversal and symlink escapes for reads and writes", async (): Promise<void> => {
    await withDirectories(async (root, outside): Promise<void> => {
      await writeFile(path.join(outside, "secret.txt"), "outside", "utf8");
      await symlink(outside, path.join(root, "linked"));
      const workspace = new WorkspaceContext(root);
      await expect(workspace.resolve("../outside/secret.txt")).rejects.toThrow("escapes");
      await expect(workspace.resolve("linked/secret.txt")).rejects.toThrow("escapes");
      await expect(workspace.resolve("linked/new.txt", "write")).rejects.toThrow("escapes");
    });
  });

  it("blocks secret-like credential files and permits safe writes in nested paths", async (): Promise<void> => {
    await withDirectories(async (root): Promise<void> => {
      await writeFile(path.join(root, ".env.local"), "secret", "utf8");
      const workspace = new WorkspaceContext(root);
      await expect(workspace.resolve(".env.local")).rejects.toThrow("sensitive files");
      const newFile = await workspace.resolve("src/nested.ts", "write");
      await mkdir(path.dirname(newFile), { recursive: true });
      await writeFile(newFile, "safe", "utf8");
      expect(await workspace.resolve("src/nested.ts")).toBe(newFile);
    });
  });
});
