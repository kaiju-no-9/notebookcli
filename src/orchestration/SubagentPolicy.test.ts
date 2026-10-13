import { describe, expect, it } from "bun:test";
import { loadRunLimits } from "../config/RunLimits.js";
import { RunContext } from "../utils/RunContext.js";
import { SubagentPolicy } from "./SubagentPolicy.js";
import type { SubagentTask } from "./SubagentTypes.js";

const tasks: SubagentTask[] = [
  { taskId: "inspect", role: "repo_inspector", objective: "Inspect the affected implementation", successCriteria: ["Identify relevant files"], access: "read_only" },
  { taskId: "tests", role: "test_planner", objective: "Review likely regression coverage", successCriteria: ["Name relevant checks"], access: "read_only" },
];

describe("SubagentPolicy", (): void => {
  it("allows only bounded complex coding plans with enough shared budget", (): void => {
    const policy = new SubagentPolicy();
    const context = new RunContext(loadRunLimits({ ODEN_MAX_SUBAGENTS: "2" } as NodeJS.ProcessEnv));
    expect(policy.evaluate("CODE_ONLY", "complex", tasks, context)).toMatchObject({ allowed: true, tasks });
    expect(policy.evaluate("DIRECT", "complex", tasks, context).allowed).toBe(false);
    expect(policy.evaluate("CODE_ONLY", "simple", tasks, context).allowed).toBe(false);
    expect(policy.evaluate("CODE_ONLY", "complex", undefined, context).allowed).toBe(false);
  });

  it("rejects duplicate IDs, invalid roles, writable access, and overlarge plans", (): void => {
    const policy = new SubagentPolicy();
    const context = new RunContext(loadRunLimits({ ODEN_MAX_SUBAGENTS: "2" } as NodeJS.ProcessEnv));
    expect(policy.evaluate("CODE_ONLY", "complex", [tasks[0]!, { ...tasks[1]!, taskId: tasks[0]!.taskId }], context).allowed).toBe(false);
    expect(policy.evaluate("CODE_ONLY", "complex", [tasks[0]!, { ...tasks[1]!, access: "write" } as unknown as SubagentTask], context).allowed).toBe(false);
    expect(policy.evaluate("CODE_ONLY", "complex", [tasks[0]!, tasks[1]!, { ...tasks[1]!, taskId: "third", objective: "A different third workstream" }], context).tasks).toHaveLength(2);
  });

  it("skips delegation when the parent request reserve cannot be held", (): void => {
    const policy = new SubagentPolicy();
    const limits = { ...loadRunLimits({} as NodeJS.ProcessEnv), maxLLMRequests: 4 };
    expect(policy.evaluate("CODE_ONLY", "complex", tasks, new RunContext(limits)).allowed).toBe(false);
  });

  it("automatically delegates eligible complex tasks by default while keeping simple tasks single-agent", (): void => {
    const policy = new SubagentPolicy();
    const context = new RunContext(loadRunLimits({} as NodeJS.ProcessEnv));
    expect(context.limits.maxSubagents).toBe(2);
    expect(policy.evaluate("CODE_ONLY", "complex", tasks, context)).toMatchObject({ allowed: true, tasks });
    expect(policy.evaluate("CODE_ONLY", "simple", tasks, context).allowed).toBe(false);
    expect(policy.evaluate("CODE_ONLY", "complex", tasks, new RunContext(loadRunLimits({ ODEN_MAX_SUBAGENTS: "0" } as NodeJS.ProcessEnv))).allowed).toBe(false);
  });

  it("keeps the labelled simple eval bucket on the existing route and accepts the complex bucket", (): void => {
    const policy = new SubagentPolicy();
    const context = new RunContext(loadRunLimits({ ODEN_MAX_SUBAGENTS: "2" } as NodeJS.ProcessEnv));
    const simpleCases = [
      { route: "DIRECT", complexity: "simple" },
      { route: "CODE_ONLY", complexity: "simple" },
    ];
    for (const item of simpleCases) {
      expect(policy.evaluate(item.route, item.complexity, tasks, context).allowed).toBe(false);
    }
    expect(policy.evaluate("CODE_ONLY", "complex", tasks, context).allowed).toBe(true);
  });
});
