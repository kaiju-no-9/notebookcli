import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface ExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface SpawnedProcess {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
}

export class ExecutionManager {
  private static readonly composeFile = fileURLToPath(new URL("../../docker-compose.yaml", import.meta.url));
  private static readonly odenRoot = path.dirname(ExecutionManager.composeFile);

  public static async ensureContainer(workspaceRoot: string = process.env.ODEN_WORKSPACE ?? process.cwd()): Promise<void> {
    const result = await ExecutionManager.runProcess(ExecutionManager.composeCommand(workspaceRoot, "up", "-d", "sandbox"), undefined, workspaceRoot);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `docker compose up failed with exit code ${result.exitCode}`);
    }
  }

  public static async execute(command: string, timeout: number = 30_000, workspaceRoot: string = process.env.ODEN_WORKSPACE ?? process.cwd()): Promise<ExecResult> {
    await ExecutionManager.ensureContainer(workspaceRoot);
    return ExecutionManager.runProcess(ExecutionManager.composeCommand(workspaceRoot, "exec", "-w", "/home/sandbox/workspace", "sandbox", "bash", "-c", command), timeout, workspaceRoot);
  }

  public static async stopContainer(workspaceRoot: string = process.env.ODEN_WORKSPACE ?? process.cwd()): Promise<void> {
    const result = await ExecutionManager.runProcess(ExecutionManager.composeCommand(workspaceRoot, "stop", "sandbox"), undefined, workspaceRoot);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `docker compose stop failed with exit code ${result.exitCode}`);
    }
  }

  private static composeCommand(workspaceRoot: string, ...args: string[]): string[] {
    const identity = createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 12);
    return ["docker", "compose", "-f", ExecutionManager.composeFile, "--project-directory", ExecutionManager.odenRoot, "-p", `oden-${identity}`, ...args];
  }

  private static async runProcess(command: string[], timeout?: number, workspaceRoot: string = process.cwd()): Promise<ExecResult> {
    const child = Bun.spawn(command, {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ODEN_WORKSPACE_ROOT: path.resolve(workspaceRoot) },
    }) as SpawnedProcess;
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const exitPromise: Promise<number> = child.exited;
    const exitCode = timeout === undefined || timeout <= 0
      ? await exitPromise
      : await Promise.race([
          exitPromise,
          new Promise<number>((resolve): void => {
            timeoutHandle = setTimeout((): void => {
              timedOut = true;
              child.kill();
              resolve(124);
            }, timeout);
          }),
        ]);
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    if (timedOut) {
      await exitPromise;
    }
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    return {
      stdout,
      stderr: timedOut ? `${stderr}${stderr.length > 0 ? "\n" : ""}Command timed out after ${timeout} ms` : stderr,
      exitCode: timedOut ? 124 : exitCode,
    };
  }
}
