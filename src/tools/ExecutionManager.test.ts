import { describe, expect, it, spyOn } from "bun:test";
import { ExecutionManager } from "./ExecutionManager.js";
import { executeCommandTool } from "./executeTools.js";

interface SpawnOptionsForTest { readonly env?: Record<string, string | undefined>; readonly cwd?: string; }

function mockProcess(stdout: string, stderr: string, exitCode: number): Bun.Subprocess {
  return {
    stdout: new Blob([stdout]).stream(),
    stderr: new Blob([stderr]).stream(),
    exited: Promise.resolve(exitCode),
    kill: (): void => undefined,
  } as Bun.Subprocess;
}

describe("ExecutionManager", (): void => {
  it("starts the sandbox and captures stdout, stderr, and exit code", async (): Promise<void> => {
    const commands: string[][] = [];
    const workspace = "/tmp/oden-selected-workspace";
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((command: string[], options?: SpawnOptionsForTest): Bun.Subprocess => {
      commands.push(command);
      expect((options?.env as Record<string, string>)?.ODEN_WORKSPACE_ROOT).toBe(workspace);
      return command.includes("exec")
        ? mockProcess("hello\n", "warning\n", 7)
        : mockProcess("started\n", "", 0);
    }) as typeof Bun.spawn);

    const result = await ExecutionManager.execute("echo hello", 1000, workspace);

    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain("-f");
    expect(commands[0]).toContain("-p");
    expect(commands[0]?.slice(-3)).toEqual(["up", "-d", "sandbox"]);
    expect(commands[1]).toContain("exec");
    expect(commands[1]).toContain("/home/sandbox/workspace");
    expect(commands[1]?.slice(-3)).toEqual(["bash", "-c", "echo hello"]);
    expect(result).toEqual({ stdout: "hello\n", stderr: "warning\n", exitCode: 7 });
    spawnSpy.mockRestore();
  });

  it("stops the compose sandbox", async (): Promise<void> => {
    const commands: string[][] = [];
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((command: string[]): Bun.Subprocess => {
      commands.push(command);
      return mockProcess("", "", 0);
    }) as typeof Bun.spawn);
    await ExecutionManager.stopContainer();
    expect(commands[0]?.slice(-2)).toEqual(["stop", "sandbox"]);
    spawnSpy.mockRestore();
  });

  it("does not execute blocked commands", async (): Promise<void> => {
    const spawnSpy = spyOn(Bun, "spawn");
    const result = await executeCommandTool.execute({ command: "rm -rf /" });
    expect(result).toContain("Command blocked:");
    expect(spawnSpy).not.toHaveBeenCalled();
    spawnSpy.mockRestore();
  });

  it("requires approval before running a confirmation-class command", async (): Promise<void> => {
    let spawnCalls = 0;
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((): Bun.Subprocess => {
      spawnCalls += 1;
      return mockProcess("ran", "", 0);
    }) as typeof Bun.spawn);
    try {
      expect(await executeCommandTool.execute({ command: "rm -rf build" })).toContain("approval is unavailable");
      expect(spawnCalls).toBe(0);
      let approvedAction = "";
      const result = await executeCommandTool.execute({ command: "rm -rf build" }, {
        runId: "run-test",
        approvalService: { requestApproval: async (request): Promise<{ status: "approved" }> => {
          approvedAction = request.action;
          return { status: "approved" };
        } },
      });
      expect(approvedAction).toBe("rm -rf build");
      expect(result).toContain("exitCode: 0");
      expect(spawnCalls).toBe(2);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});
