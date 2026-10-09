import { describe, expect, it, spyOn } from "bun:test";
import { ExecutionManager } from "./ExecutionManager.js";
import { executeCommandTool } from "./executeTools.js";

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
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((command: string[]): Bun.Subprocess => {
      commands.push(command);
      return command[1] === "exec"
        ? mockProcess("hello\n", "warning\n", 7)
        : mockProcess("started\n", "", 0);
    }) as typeof Bun.spawn);

    const result = await ExecutionManager.execute("echo hello", 1000);

    expect(commands).toEqual([
      ["docker", "compose", "up", "-d", "sandbox"],
      ["docker", "exec", "sandbox", "bash", "-c", "echo hello"],
    ]);
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
    expect(commands).toEqual([["docker", "compose", "stop", "sandbox"]]);
    spawnSpy.mockRestore();
  });

  it("does not execute blocked commands", async (): Promise<void> => {
    const spawnSpy = spyOn(Bun, "spawn");
    const result = await executeCommandTool.execute({ command: "rm -rf /" });
    expect(result).toContain("Command blocked:");
    expect(spawnSpy).not.toHaveBeenCalled();
    spawnSpy.mockRestore();
  });
});
