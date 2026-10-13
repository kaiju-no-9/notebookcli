import { randomUUID } from "node:crypto";

export type ApprovalCategory = "shell" | "git" | "file_write";
export type ApprovalRisk = "moderate" | "high";

export interface ApprovalRequest {
  readonly requestId: string;
  readonly runId: string;
  readonly category: ApprovalCategory;
  readonly risk: ApprovalRisk;
  readonly action: string;
  readonly target: string;
  readonly workspaceRoot: string;
  readonly reason: string;
}

export interface ApprovalDecision {
  readonly status: "approved" | "denied" | "cancelled";
  readonly reason?: string;
}

export interface ApprovalService {
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface ToolExecutionContext {
  readonly runId: string;
  readonly approvalService?: ApprovalService;
}

export function createApprovalRequest(request: Omit<ApprovalRequest, "requestId">): ApprovalRequest {
  return Object.freeze({ ...request, requestId: randomUUID() });
}
