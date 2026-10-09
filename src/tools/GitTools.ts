import { z } from "zod";
import { CommandPolicy } from "./CommandPolicy.js";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";

const gitParameters = z.object({ command: z.string().min(1) });

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseArguments(command: string): string[] {
  const args: string[] = [];
  let value = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        value += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (value.length > 0) {
        args.push(value);
        value = "";
      }
    } else {
      value += character;
    }
  }
  if (escaped || quote !== null) {
    throw new Error("Unterminated escape or quote in git command");
  }
  if (value.length > 0) {
    args.push(value);
  }
  if (args.length === 0) {
    throw new Error("Git subcommand is required");
  }
  return args;
}

export const gitCommandTool: ToolDefinition = {
  name: "git_command",
  description: "Run a Git subcommand in the host project repository.",
  parameters: gitParameters,
  execute: async (args: unknown): Promise<string> => {
    try {
      const { command } = gitParameters.parse(args);
      const classification = CommandPolicy.classify(`git ${command}`);
      if (classification.action === "BLOCK") {
        return `Git command blocked: ${classification.reason}`;
      }
      if (classification.action === "CONFIRM") {
        return `Confirmation required: ${classification.reason}. Command was not executed.`;
      }
      const child = Bun.spawn(["git", ...parseArguments(command)], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return `stdout:\n${stdout}\nstderr:\n${stderr}\nexitCode: ${exitCode}`;
    } catch (error: unknown) {
      return `Error running git command: ${errorMessage(error)}`;
    }
  },
};

export function registerGitTools(registry: ToolRegistry): void {
  registry.register(gitCommandTool);
}
