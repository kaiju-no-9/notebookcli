import { describe, expect, it, spyOn } from "bun:test";
import { gitCommandTool } from "./GitTools.js";
import { registerGitTools } from "./GitTools.js";
import { ToolRegistry } from "./ToolRegistry.js";
import { WorkspaceContext } from "../utils/WorkspaceContext.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface SpawnOptionsForTest { readonly cwd?: string; readonly env?: Record<string, string | undefined>; }

function mockProcess(stdout: string, stderr: string, exitCode: number): Bun.Subprocess {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: (): void => undefined,
  } as Bun.Subprocess;
}

describe("git_command", (): void => {
  it("runs git status directly and returns captured output", async (): Promise<void> => {
    let command: string[] = [];
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((args: string[], options?: SpawnOptionsForTest): Bun.Subprocess => {
      command = args;
      expect(options?.cwd).toBe(process.cwd());
      return mockProcess("On branch main\n", "", 0);
    }) as typeof Bun.spawn);

    const result = await gitCommandTool.execute({ command: "status" });

    expect(command).toEqual(["git", "status"]);
    expect(result).toContain("On branch main");
    expect(result).toContain("exitCode: 0");
    spawnSpy.mockRestore();
  });

  it("runs Git in the injected host workspace", async (): Promise<void> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oden-git-workspace-"));
    try {
      let cwd: string | undefined;
      const registry = new ToolRegistry();
      registerGitTools(registry, new WorkspaceContext(directory));
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((_args: string[], options?: SpawnOptionsForTest): Bun.Subprocess => {
        cwd = options?.cwd as string | undefined;
        return mockProcess("", "", 0);
      }) as typeof Bun.spawn);
      const result = await registry.get("git_command")?.execute({ command: "status" });
      expect(cwd).toBe(new WorkspaceContext(directory).root);
      expect(result).toContain("exitCode: 0");
      spawnSpy.mockRestore();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("clears Git environment overrides that could redirect outside the workspace", async (): Promise<void> => {
    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = "/tmp/external-repository/.git";
    try {
      let gitDir: string | undefined;
      const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((_args: string[], options?: SpawnOptionsForTest): Bun.Subprocess => {
        gitDir = options?.env?.GIT_DIR;
        return mockProcess("", "", 0);
      }) as typeof Bun.spawn);
      await gitCommandTool.execute({ command: "status" });
      expect(gitDir).toBeUndefined();
      spawnSpy.mockRestore();
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }
  });

  it("blocks force pushes and returns parse failures as strings", async (): Promise<void> => {
    const blocked = await gitCommandTool.execute({ command: "push --force" });
    expect(blocked).toContain("Git command blocked:");
    expect(await gitCommandTool.execute({ command: "-C /tmp status" })).toContain("repository path overrides");
    expect(await gitCommandTool.execute({ command: "-c core.worktree=/tmp status" })).toContain("repository path overrides");
    const invalid = await gitCommandTool.execute({ command: "log 'unterminated" });
    expect(invalid).toContain("Error running git command:");
  });

  it("denies a Git mutation without approval and executes the exact approved command", async (): Promise<void> => {
    let spawnCalls = 0;
    let args: string[] = [];
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((command: string[], _options?: SpawnOptionsForTest): Bun.Subprocess => {
      spawnCalls += 1;
      args = command;
      return mockProcess("committed", "", 0);
    }) as typeof Bun.spawn);
    try {
      expect(await gitCommandTool.execute({ command: "commit -m done" })).toContain("approval is unavailable");
      expect(spawnCalls).toBe(0);
      const denied = await gitCommandTool.execute({ command: "commit -m denied" }, {
        runId: "run-test",
        approvalService: { requestApproval: async (): Promise<{ status: "denied" }> => ({ status: "denied" }) },
      });
      expect(denied).toContain("Git action denied");
      expect(spawnCalls).toBe(0);
      let action = "";
      const result = await gitCommandTool.execute({ command: "commit -m done" }, {
        runId: "run-test",
        approvalService: { requestApproval: async (request): Promise<{ status: "approved" }> => { action = request.action; return { status: "approved" }; } },
      });
      expect(action).toBe("git commit -m done");
      expect(args).toEqual(["git", "commit", "-m", "done"]);
      expect(result).toContain("committed");
      expect(spawnCalls).toBe(1);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});
