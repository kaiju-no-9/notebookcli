import { z } from "zod";

export const SUBAGENT_ROLES = ["repo_inspector", "documentation_researcher", "test_planner"] as const;
export const SubagentTaskSchema = z.object({
  taskId: z.string().min(1).max(40),
  role: z.enum(SUBAGENT_ROLES),
  objective: z.string().trim().min(8).max(500),
  successCriteria: z.array(z.string().trim().min(1).max(200)).min(1).max(4),
  paths: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
  access: z.literal("read_only"),
}).strict();

// Keep this schema JSON-Schema compatible for Gemini and OpenRouter response formats.
// Cross-item uniqueness and independence are enforced by SubagentPolicy.
export const SubagentPlanSchema = z.array(SubagentTaskSchema).min(2).max(3);

export const SubagentResultSchema = z.object({
  taskId: z.string().min(1).max(40),
  status: z.enum(["complete", "partial", "failed", "cancelled"]),
  summary: z.string().max(1_500),
  evidence: z.array(z.object({
    source: z.string().min(1).max(300),
    detail: z.string().max(800),
  }).strict()).max(6),
  uncertainties: z.array(z.string().max(300)).max(4),
  suggestedNextSteps: z.array(z.string().max(300)).max(4),
}).strict();

export type SubagentRole = (typeof SUBAGENT_ROLES)[number];
export type SubagentTask = z.infer<typeof SubagentTaskSchema>;
export type SubagentResult = z.infer<typeof SubagentResultSchema>;

export function parseSubagentResult(value: unknown, expectedTaskId: string): SubagentResult {
  const result = SubagentResultSchema.parse(value);
  if (result.taskId !== expectedTaskId) throw new Error("subagent result task ID did not match its assignment");
  for (const item of result.evidence) {
    const isHttpsUrl = /^https:\/\/[^\s]+$/.test(item.source);
    const hasLineRange = /:\d+(?:-\d+)?$/.test(item.source);
    const hasTraversal = item.source.split(/[\\/]/).includes("..");
    if (!isHttpsUrl && (!hasLineRange || item.source.startsWith("/") || hasTraversal)) {
      throw new Error("subagent evidence must use a workspace-relative path with line numbers or an HTTPS URL");
    }
  }
  return result;
}
