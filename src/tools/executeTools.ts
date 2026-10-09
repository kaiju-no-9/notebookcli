import { z } from "zod";
import { CommandPolicy } from "./CommandPolicy.js";
import { ExecutionManager } from "./ExecutionManager.js";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";

const executeParameters = z.object({
  command: z.string().min(1),
  timeout: z.number().int().positive().max(600_000).default(30_000),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const executeCommandTool: ToolDefinition = {
  name: "execute_command",
  description: "Run a policy-approved shell command in the isolated Docker sandbox.",
  parameters: executeParameters,
  execute: async (args: unknown): Promise<string> => {
    try {
      const { command, timeout } = executeParameters.parse(args);
      const classification = CommandPolicy.classify(command);
      if (classification.action === "BLOCK") {
        return `Command blocked: ${classification.reason}`;
      }
      if (classification.action === "CONFIRM") {
        return `Confirmation required: ${classification.reason}. Command was not executed.`;
      }
      const result = await ExecutionManager.execute(command, timeout);
      return `stdout:\n${result.stdout}\nstderr:\n${result.stderr}\nexitCode: ${result.exitCode}`;
    } catch (error: unknown) {
      return `Error executing command: ${errorMessage(error)}`;
    }
  },
};

export function registerExecuteTools(registry: ToolRegistry): void {
  registry.register(executeCommandTool);
}
