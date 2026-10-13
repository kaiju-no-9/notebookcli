import { z } from "zod";
import { CommandPolicy } from "./CommandPolicy.js";
import { ExecutionManager } from "./ExecutionManager.js";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";
import { WorkspaceContext } from "../utils/WorkspaceContext.js";
import { createApprovalRequest } from "./Approval.js";

const executeParameters = z.object({
  command: z.string().min(1),
  timeout: z.number().int().positive().max(600_000).default(30_000),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createExecuteCommandTool(workspace: WorkspaceContext): ToolDefinition {
  return {
  name: "execute_command",
  description: "Run a policy-approved shell command in the isolated Docker sandbox.",
  parameters: executeParameters,
  execute: async (args: unknown, context): Promise<string> => {
    try {
      const { command, timeout } = executeParameters.parse(args);
      const classification = CommandPolicy.classify(command);
      if (classification.action === "BLOCK") {
        return `Command blocked: ${classification.reason}`;
      }
      if (classification.action === "CONFIRM") {
        if (context?.approvalService === undefined) return `Action denied: approval is unavailable. ${classification.reason} Command was not executed.`;
        const request = createApprovalRequest({
          runId: context.runId,
          category: "shell",
          risk: "high",
          action: command,
          target: workspace.root,
          workspaceRoot: workspace.root,
          reason: classification.reason,
        });
        const decision = await context.approvalService.requestApproval(request);
        if (decision.status !== "approved") return `Action ${decision.status}: ${decision.reason ?? "Command was not approved."} Command was not executed.`;
      }
      const result = await ExecutionManager.execute(command, timeout, workspace.root);
      return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}\nexitCode: ${result.exitCode}`;
    } catch (error: unknown) {
      return `Error executing command: ${errorMessage(error)}`;
    }
  },
  };
}

const defaultWorkspace = new WorkspaceContext();
export const executeCommandTool: ToolDefinition = createExecuteCommandTool(defaultWorkspace);

export function registerExecuteTools(registry: ToolRegistry, workspace: WorkspaceContext = defaultWorkspace): void {
  registry.register(createExecuteCommandTool(workspace));
}
