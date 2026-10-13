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
    const service = new TerminalApprovalService((): boolean => false, async (): Promise<boolean> => { prompted = true; return true; });
    expect(await service.requestApproval(request)).toEqual({ status: "denied", reason: "Approval requires an interactive terminal." });
    expect(prompted).toBe(false);
  });

  it("shows the exact action and target and returns approval", async (): Promise<void> => {
    let message = "";
    let receivedSignal: AbortSignal | undefined;
    const service = new TerminalApprovalService((): boolean => true, async (prompt, signal): Promise<boolean> => {
      message = prompt;
      receivedSignal = signal;
      return true;
    });
    expect(await service.requestApproval(request)).toEqual({ status: "approved" });
    expect(message).toContain("rm -rf build");
    expect(message).toContain("/project/build");
    expect(receivedSignal?.aborted).toBe(false);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it("turns prompt cancellation into a denial", async (): Promise<void> => {
    const service = new TerminalApprovalService((): boolean => true, async (): Promise<boolean> => { throw new Error("cancelled"); });
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
