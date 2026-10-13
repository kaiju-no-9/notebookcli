import { describe, expect, it } from "bun:test";
import { loadRunLimits } from "../config/RunLimits.js";
import { RunBudgetError, RunContext } from "../utils/RunContext.js";
import { SubagentCoordinator } from "./SubagentCoordinator.js";
import { parseSubagentResult, type SubagentTask } from "./SubagentTypes.js";

const tasks: SubagentTask[] = [
  { taskId: "inspect", role: "repo_inspector", objective: "Inspect the affected implementation", successCriteria: ["Identify relevant files"], access: "read_only" },
  { taskId: "tests", role: "test_planner", objective: "Review likely regression coverage", successCriteria: ["Name relevant checks"], access: "read_only" },
];
const result = (taskId: string): string => JSON.stringify({ taskId, status: "complete", summary: "Found relevant code.", evidence: [{ source: "src/main.ts:1-4", detail: "Entry point" }], uncertainties: [], suggestedNextSteps: [] });

describe("SubagentCoordinator", (): void => {
  it("validates bounded result identity and relative evidence references", (): void => {
    expect((): void => { parseSubagentResult(JSON.parse(result("other")) as unknown, "inspect"); }).toThrow("task ID");
    const absolute = JSON.parse(result("inspect")) as { evidence: Array<{ source: string; detail: string }> };
    absolute.evidence[0]!.source = "/tmp/private.ts:1-2";
    expect((): void => { parseSubagentResult(absolute, "inspect"); }).toThrow("workspace-relative");
    expect(parseSubagentResult(JSON.parse(result("inspect")) as unknown, "inspect").status).toBe("complete");
  });

  it("runs at most two independent specialists concurrently on the shared run context", async (): Promise<void> => {
    const threeTasks: SubagentTask[] = [...tasks, { taskId: "docs", role: "documentation_researcher", objective: "Review relevant current documentation", successCriteria: ["Find source links"], access: "read_only" }];
    let active = 0;
    let maximumActive = 0;
    let observedContext: RunContext | undefined;
    const context = new RunContext(loadRunLimits({ ODEN_MAX_SUBAGENTS: "3" } as NodeJS.ProcessEnv));
    const coordinator = new SubagentCoordinator(() => ({
      run: async (input, systemPrompt, maxSteps, runContext): Promise<{ response: string }> => {
        expect(systemPrompt).toContain("read-only");
        expect(maxSteps).toBe(2);
        expect(JSON.parse(input)).toHaveProperty("userGoal");
        observedContext = runContext;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve): void => { setTimeout(resolve, 5); });
        active -= 1;
        const taskId = JSON.parse(input) as { taskId: string };
        return { response: result(taskId.taskId) };
      },
    }));
    const results = await coordinator.run(threeTasks, "Make a complex feature", context);
    expect(maximumActive).toBe(2);
    expect(observedContext).toBe(context);
    expect(results.map((entry): string => entry.taskId)).toEqual(["inspect", "tests", "docs"]);
    expect(coordinator.formatEvidence(results)).toContain("untrusted_read_only_specialist_evidence");
  });

  it("keeps valid evidence when one child fails and propagates shared budget stops", async (): Promise<void> => {
    let call = 0;
    const context = new RunContext(loadRunLimits({} as NodeJS.ProcessEnv));
    const coordinator = new SubagentCoordinator(() => ({ run: async (input): Promise<{ response: string }> => {
      call += 1;
      if (call === 1) return { response: result((JSON.parse(input) as { taskId: string }).taskId) };
      throw new Error("specialist unavailable");
    } }));
    const results = await coordinator.run(tasks, "Make a complex feature", context);
    expect(results.map((entry): string => entry.status)).toEqual(["complete", "failed"]);
    expect(coordinator.formatEvidence(results)).toContain("Found relevant code");
    const budgetStopped = new SubagentCoordinator(() => ({ run: async (): Promise<{ response: string }> => { throw new RunBudgetError("test budget stop"); } }));
    await expect(budgetStopped.run(tasks, "Make a complex feature", context)).rejects.toBeInstanceOf(RunBudgetError);
  });
});
