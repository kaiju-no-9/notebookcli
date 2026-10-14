import { stdin } from "node:process";
import type { ApprovalDecision, ApprovalRequest, ApprovalService } from "../tools/Approval.js";

type ApprovalChoice = "diff" | "action" | "approve" | "reject";
type ApprovalPrompt = (message: string, signal: AbortSignal, hasDiff: boolean) => Promise<ApprovalChoice>;

async function terminalPrompt(message: string, signal: AbortSignal, hasDiff: boolean): Promise<ApprovalChoice> {
  const { select } = await import("@inquirer/prompts");
  const reviewChoices = hasDiff
    ? [{ name: "Review diff", value: "diff" as const }, { name: "View exact action", value: "action" as const }]
    : [{ name: "View exact action", value: "action" as const }];
  return select({
    message,
    choices: [
      ...reviewChoices,
      { name: "Approve exact action", value: "approve" as const },
      { name: "Reject", value: "reject" as const },
    ],
    loop: false,
  }, { signal });
}

export class TerminalApprovalService implements ApprovalService {
  public constructor(
    private readonly isInteractive: () => boolean = (): boolean => stdin.isTTY === true,
    private readonly prompt: ApprovalPrompt = terminalPrompt,
    private readonly timeoutMs: number = 120_000,
    private readonly showReview: (text: string) => void = (text: string): void => { console.log(text); },
  ) {}

  public async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.isInteractive()) return { status: "denied", reason: "Approval requires an interactive terminal." };
    const controller = new AbortController();
    const timer = setTimeout((): void => controller.abort(new Error("Approval prompt timed out.")), this.timeoutMs);
    try {
      const summary = request.summary ?? request.action;
      const message = [
        `ODEN APPROVAL REQUIRED · ${request.risk.toUpperCase()} RISK`,
        `${request.category === "file_write" ? "Change" : "Action"}: ${summary}`,
        `Target: ${request.target}`,
        `Workspace: ${request.workspaceRoot}`,
        `Reason: ${request.reason}`,
      ].join("\n");
      while (true) {
        const choice = await this.prompt(message, controller.signal, request.preview !== undefined);
        if (choice === "diff" || choice === "action") {
          this.showReview(sanitizeTerminalText(choice === "diff" ? request.preview ?? request.action : request.action));
          continue;
        }
        return choice === "approve"
          ? { status: "approved" }
          : { status: "denied", reason: "The action was rejected." };
      }
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

function sanitizeTerminalText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, (character): string => {
    return `\\x${character.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}
