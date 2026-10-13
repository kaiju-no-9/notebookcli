import { z } from "zod";
import { CommandPolicy } from "./CommandPolicy.js";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";
import { WorkspaceContext } from "../utils/WorkspaceContext.js";
import { createApprovalRequest } from "./Approval.js";

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

function createGitCommandTool(workspace: WorkspaceContext): ToolDefinition {
  return {
  name: "git_command",
  description: "Run a Git subcommand in the host project repository.",
  parameters: gitParameters,
  execute: async (args: unknown, context): Promise<string> => {
    try {
      const { command } = gitParameters.parse(args);
      const gitArgs = parseArguments(command);
      if (gitArgs.some((argument): boolean => argument === "-C" || argument.startsWith("-C") || argument === "-c" || argument.startsWith("-c") || argument === "--config-env" || argument.startsWith("--config-env=") || argument === "--git-dir" || argument.startsWith("--git-dir=") || argument === "--work-tree" || argument.startsWith("--work-tree="))) {
        return "Git command blocked: repository path overrides must stay inside the selected workspace.";
      }
      const classification = CommandPolicy.classify(`git ${command}`);
      if (classification.action === "BLOCK") {
        return `Git command blocked: ${classification.reason}`;
      }
      if (classification.action === "CONFIRM") {
        if (context?.approvalService === undefined) return `Git action denied: approval is unavailable. ${classification.reason} Command was not executed.`;
        const request = createApprovalRequest({
          runId: context.runId,
          category: "git",
          risk: "high",
          action: `git ${command}`,
          target: workspace.root,
          workspaceRoot: workspace.root,
          reason: classification.reason,
        });
        const decision = await context.approvalService.requestApproval(request);
        if (decision.status !== "approved") return `Git action ${decision.status}: ${decision.reason ?? "Command was not approved."} Command was not executed.`;
      }
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_CONFIG"].includes(key) || key.startsWith("GIT_CONFIG_")) {
          delete env[key];
        }
      }
      const child = Bun.spawn(["git", ...gitArgs], { cwd: workspace.root, env, stdout: "pipe", stderr: "pipe" });
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
}

const defaultWorkspace = new WorkspaceContext();
export const gitCommandTool: ToolDefinition = createGitCommandTool(defaultWorkspace);

export function registerGitTools(registry: ToolRegistry, workspace: WorkspaceContext = defaultWorkspace): void {
  registry.register(createGitCommandTool(workspace));
}
