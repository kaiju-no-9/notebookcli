import { describe, expect, it } from "bun:test";
import { FakeLLM } from "../agent/FakeLLM.js";
import type { AgentResult } from "../agent/Agent.js";
import { AgentMode } from "../agent/AgentMode.js";
import type { ResearchBrief } from "../agent/ResearchAgent.js";
import type { GuardrailResult } from "../guardrails/types/GuardrailResult.js";
import { Orchestrator } from "../orchestration/Orchestrator.js";
import { RouteDecision } from "../orchestration/Supervisor.js";
import { AgentCLI, type PromptReader } from "./AgentCLI.js";
import { AgentUI } from "./AgentUI.js";
import { TerminalState } from "./TerminalState.js";

class QueueReader implements PromptReader {
  public closed = false;
  public constructor(private readonly answers: string[]) {}

  public async question(): Promise<string> {
    const answer = this.answers.shift();
    if (answer === undefined) {
      throw new Error("No more input");
    }
    return answer;
  }

  public close(): void {
    this.closed = true;
  }
}

describe("AgentCLI", (): void => {
  it("handles exit and renders orchestrator responses", async (): Promise<void> => {
    const outputs: string[] = [];
    const inputs: string[] = [];
    const reader = new QueueReader(["hello", "exit"]);
    const state = new TerminalState();
    const cli = new AgentCLI(
      { process: async (input: string): Promise<string> => { inputs.push(input); return "Hi from Oden"; } },
      new AgentUI((text: string): void => { outputs.push(text); }),
      state,
      reader,
    );
    await cli.start();
    expect(inputs).toEqual(["hello"]);
    expect(outputs).toEqual(["Oden is ready. Enter 'exit' or 'quit' to leave.", "Hi from Oden", "Goodbye."]);
    expect(reader.closed).toBe(true);
    expect(state.currentSpinnerMessage).toBeUndefined();
  });

  it("handles quit and skips blank input", async (): Promise<void> => {
    const inputs: string[] = [];
    const reader = new QueueReader(["  ", "task", "quit"]);
    const cli = new AgentCLI(
      { process: async (input: string): Promise<string> => { inputs.push(input); return "done"; } },
      new AgentUI((): void => undefined),
      new TerminalState(),
      reader,
    );
    await cli.start();
    expect(inputs).toEqual(["task"]);
  });

  it("keeps the REPL alive after an orchestrator error", async (): Promise<void> => {
    const outputs: string[] = [];
    let calls = 0;
    const cli = new AgentCLI(
      { process: async (): Promise<string> => {
        calls += 1;
        if (calls === 1) {
          throw new Error("temporary failure");
        }
        return "recovered";
      } },
      new AgentUI((text: string): void => { outputs.push(text); }),
      new TerminalState(),
      new QueueReader(["first", "second", "quit"]),
    );
    await cli.start();
    expect(outputs).toContain("Request failed: temporary failure");
    expect(outputs).toContain("recovered");
  });

  it("runs the guarded orchestrator pipeline through to terminal output", async (): Promise<void> => {
    const order: string[] = [];
    const outputs: string[] = [];
    const safeResult = (): GuardrailResult => ({ allowed: true, reason: "safe", confidence: 1, stage: "test" });
    const agentResult: AgentResult = { response: "unused", steps: 1, toolCalls: [], mode: AgentMode.ACT };
    const researchBrief: ResearchBrief = { summary: "unused", keyFindings: [], sources: [] };
    const orchestrator = new Orchestrator(
      new FakeLLM([]),
      {
        stream: async (messages, onToken): Promise<string> => {
          order.push("stream");
          expect(messages.at(-1)?.parts[0]).toEqual({ text: "hello" });
          onToken("Safe answer");
          return "Safe answer";
        },
      },
      { run: async (): Promise<AgentResult> => agentResult },
      { run: async (): Promise<ResearchBrief> => researchBrief },
      { check: async (): Promise<GuardrailResult> => { order.push("input guard"); return safeResult(); } },
      { check: async (): Promise<GuardrailResult> => { order.push("output guard"); return safeResult(); } },
      { classify: async () => {
        order.push("classification");
        return { route: RouteDecision.DIRECT, reasoning: "simple greeting", confidence: 1 };
      } },
    );
    const cli = new AgentCLI(
      orchestrator,
      new AgentUI((text: string): void => { outputs.push(text); }),
      new TerminalState(),
      new QueueReader(["hello", "quit"]),
    );

    await cli.start();

    expect(order).toEqual(["input guard", "classification", "stream", "output guard"]);
    expect(outputs).toEqual([
      "Oden is ready. Enter 'exit' or 'quit' to leave.",
      "Safe answer",
      "Goodbye.",
    ]);
  });
});
