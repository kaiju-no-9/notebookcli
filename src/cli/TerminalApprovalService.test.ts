import { describe, expect, it } from "bun:test";
import { TerminalApprovalService } from "./TerminalApprovalService.js";
import { createApprovalRequest } from "../tools/Approval.js";

const request = createApprovalRequest({
  runId: "run-test", category: "shell", risk: "high", action: "rm -rf build", target: "/project/build",
  workspaceRoot: "/project", reason: "Recursive deletion requires confirmation",
});

describe("TerminalApprovalService", (): void => {
  it("fails closed without an interactive terminal", async (): Promise<void> => {
    let prompted = false;
    const service = new TerminalApprovalService((): boolean => false, async (): Promise<"approve"> => { prompted = true; return "approve"; });
    expect(await service.requestApproval(request)).toEqual({ status: "denied", reason: "Approval requires an interactive terminal." });
    expect(prompted).toBe(false);
  });

  it("shows a concise summary and target, reveals the diff on request, then approves", async (): Promise<void> => {
    let message = "";
    let receivedSignal: AbortSignal | undefined;
    const reviews: string[] = [];
    let promptCount = 0;
    const fileRequest = createApprovalRequest({
      runId: "run-test", category: "file_write", risk: "moderate", action: "{\"content\":\"long generated html\"}",
      summary: "Replace existing file · 80 lines · 4 KB", preview: "--- a/index.html\n+++ b/index.html\n-old\n+new",
      target: "/project/index.html", workspaceRoot: "/project", reason: "Overwriting an existing file requires approval",
    });
    const service = new TerminalApprovalService((): boolean => true, async (prompt, signal): Promise<"diff" | "approve"> => {
      message = prompt;
      receivedSignal = signal;
      promptCount += 1;
      return promptCount === 1 ? "diff" : "approve";
    }, 120_000, (text): void => { reviews.push(text); });
    expect(await service.requestApproval(fileRequest)).toEqual({ status: "approved" });
    expect(message).toContain("Replace existing file · 80 lines · 4 KB");
    expect(message).toContain("/project/index.html");
    expect(message).not.toContain("long generated html");
    expect(reviews).toEqual(["--- a/index.html\n+++ b/index.html\n-old\n+new"]);
    expect(promptCount).toBe(2);
    expect(receivedSignal?.aborted).toBe(false);
    expect(Object.isFrozen(fileRequest)).toBe(true);
  });

  it("turns prompt cancellation into a denial", async (): Promise<void> => {
    const service = new TerminalApprovalService((): boolean => true, async (): Promise<"reject"> => { throw new Error("cancelled"); });
    expect((await service.requestApproval(request)).status).toBe("cancelled");
  });

  it("aborts a prompt that exceeds its configured timeout", async (): Promise<void> => {
    const service = new TerminalApprovalService(
      (): boolean => true,
      (_message, signal): Promise<boolean> => new Promise((_resolve, reject): void => {
        signal.addEventListener("abort", (): void => reject(new Error("aborted")), { once: true });
      }),
      1,
    );
    expect((await service.requestApproval(request)).status).toBe("cancelled");
  });
});
