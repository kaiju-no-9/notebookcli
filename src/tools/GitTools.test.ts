import { describe, expect, it, spyOn } from "bun:test";
import { gitCommandTool } from "./GitTools.js";

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
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(((args: string[]): Bun.Subprocess => {
      command = args;
      return mockProcess("On branch main\n", "", 0);
    }) as typeof Bun.spawn);

    const result = await gitCommandTool.execute({ command: "status" });

    expect(command).toEqual(["git", "status"]);
    expect(result).toContain("On branch main");
    expect(result).toContain("exitCode: 0");
    spawnSpy.mockRestore();
  });

  it("blocks force pushes and returns parse failures as strings", async (): Promise<void> => {
    const blocked = await gitCommandTool.execute({ command: "push --force" });
    expect(blocked).toContain("Git command blocked:");
    const invalid = await gitCommandTool.execute({ command: "log 'unterminated" });
    expect(invalid).toContain("Error running git command:");
  });
});
