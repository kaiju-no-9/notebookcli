import type { RunContext } from "../utils/RunContext.js";
import { SubagentPlanSchema, type SubagentTask } from "./SubagentTypes.js";

export interface SubagentEligibility {
  readonly allowed: boolean;
  readonly reason: string;
  readonly tasks: readonly SubagentTask[];
}

export class SubagentPolicy {
  public evaluate(
    route: string,
    complexity: string | undefined,
    proposedTasks: readonly SubagentTask[] | undefined,
    runContext: RunContext | undefined,
  ): SubagentEligibility {
    if (route !== "CODE_ONLY" && route !== "RESEARCH_AND_CODE") return this.deny("route does not lead to coding");
    if (complexity !== "complex") return this.deny("task classified as simple");
    if (runContext === undefined || runContext.limits.maxSubagents < 2) return this.deny("subagents are disabled");
    if (proposedTasks === undefined) return this.deny("no delegation plan was provided");
    const parsed = SubagentPlanSchema.safeParse(proposedTasks);
    if (!parsed.success) return this.deny("delegation plan did not pass validation");
    if (new Set(parsed.data.map((task): string => task.taskId)).size !== parsed.data.length) return this.deny("task IDs must be unique");
    if (new Set(parsed.data.map((task): string => task.objective.toLocaleLowerCase())).size !== parsed.data.length) return this.deny("tasks must be independent and non-duplicative");
    const tasks = parsed.data.slice(0, Math.min(3, runContext.limits.maxSubagents));
    if (tasks.length < 2) return this.deny("fewer than two tasks fit the configured child limit");
    if (!runContext.canStartSubagents(tasks.length)) return this.deny("shared run budget cannot reserve child work and parent synthesis");
    return { allowed: true, reason: "complex task has independent read-only workstreams", tasks };
  }

  private deny(reason: string): SubagentEligibility {
    return { allowed: false, reason, tasks: [] };
  }
}
