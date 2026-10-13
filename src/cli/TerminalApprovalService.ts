import { stdin } from "node:process";
import type { ApprovalDecision, ApprovalRequest, ApprovalService } from "../tools/Approval.js";

async function terminalConfirm(message: string, signal: AbortSignal): Promise<boolean> {
  const { confirm } = await import("@inquirer/prompts");
  return confirm({ message, default: false }, { signal });
}

export class TerminalApprovalService implements ApprovalService {
  public constructor(
    private readonly isInteractive: () => boolean = (): boolean => stdin.isTTY === true,
    private readonly prompt: (message: string, signal: AbortSignal) => Promise<boolean> = terminalConfirm,
    private readonly timeoutMs: number = 120_000,
  ) {}

  public async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.isInteractive()) return { status: "denied", reason: "Approval requires an interactive terminal." };
    const controller = new AbortController();
    const timer = setTimeout((): void => controller.abort(new Error("Approval prompt timed out.")), this.timeoutMs);
    try {
      const message = [
        `Approve ${request.category} action?`,
        `Risk: ${request.risk}.`,
        `Reason: ${request.reason}`,
        `Workspace: ${request.workspaceRoot}`,
        `Target: ${request.target}`,
        `Exact action: ${request.action}`,
      ].join("\n");
      return await this.prompt(message, controller.signal)
        ? { status: "approved" }
        : { status: "denied", reason: "The action was rejected." };
    } catch (error: unknown) {
      const reason = controller.signal.aborted
        ? "Approval prompt timed out or was interrupted."
        : error instanceof Error ? error.message : "Approval prompt failed.";
      return { status: "cancelled", reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
