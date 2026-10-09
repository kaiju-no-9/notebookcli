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
  public static async ensureContainer(): Promise<void> {
    const result = await ExecutionManager.runProcess(["docker", "compose", "up", "-d", "sandbox"]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `docker compose up failed with exit code ${result.exitCode}`);
    }
  }

  public static async execute(command: string, timeout: number = 30_000): Promise<ExecResult> {
    await ExecutionManager.ensureContainer();
    return ExecutionManager.runProcess(["docker", "exec", "sandbox", "bash", "-c", command], timeout);
  }

  public static async stopContainer(): Promise<void> {
    const result = await ExecutionManager.runProcess(["docker", "compose", "stop", "sandbox"]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || `docker compose stop failed with exit code ${result.exitCode}`);
    }
  }

  private static async runProcess(command: string[], timeout?: number): Promise<ExecResult> {
    const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" }) as SpawnedProcess;
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
