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
import { SlashCommandRouter } from "./SlashCommandRouter.js";
import { TerminalState } from "./TerminalState.js";

class QueueReader implements PromptReader {
  public closed = false;
  public readonly prompts: string[] = [];
  public constructor(private readonly answers: string[]) {}

  public async question(prompt: string): Promise<string> {
    this.prompts.push(prompt);
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

  it("intercepts slash commands and shows the active provider and model in the prompt", async (): Promise<void> => {
    let orchestratorCalls = 0;
    const outputs: string[] = [];
    const reader = new QueueReader(["/help", "quit"]);
    const router = new SlashCommandRouter();
    router.register({ name: "help", description: "Show help", execute: async () => ({ output: "help text", restart: false }) });
    const cli = new AgentCLI(
      { process: async (): Promise<string> => { orchestratorCalls += 1; return "unexpected"; } },
      new AgentUI((text: string): void => { outputs.push(text); }),
      new TerminalState(),
      reader,
      router,
      { provider: "gemini", model: "gemini-3.8-flash", providerConfigured: true },
    );

    expect(await cli.start()).toBe("exit");
    expect(orchestratorCalls).toBe(0);
    expect(reader.prompts[0]).toBe("oden [gemini/gemini-3.8-flash]> ");
    expect(outputs).toContain("help text");
  });

  it("does not repeat OpenRouter in the prompt for its openrouter/free model ID", async (): Promise<void> => {
    const reader = new QueueReader(["quit"]);
    const cli = new AgentCLI(
      { process: async (): Promise<string> => "unused" },
      new AgentUI((): void => undefined),
      new TerminalState(),
      reader,
      undefined,
      { provider: "openrouter", model: "openrouter/free", providerConfigured: true },
    );

    await cli.start();

    expect(reader.prompts).toEqual(["oden [openrouter/free]> "]);
  });

  it("allows session management without a configured provider", async (): Promise<void> => {
    let orchestratorCalls = 0;
    const outputs: string[] = [];
    const reader = new QueueReader(["do a task", "/web", "/sessions", "/status", "/help", "quit"]);
    const router = new SlashCommandRouter();
    router.register({ name: "web", description: "Configure web", execute: async () => ({ output: "web", restart: false }) });
    router.register({ name: "status", description: "Show status", execute: async () => ({ output: "status", restart: false }) });
    router.register({ name: "help", description: "Show help", execute: async () => ({ output: "help", restart: false }) });
    router.register({ name: "sessions", description: "Manage sessions", execute: async () => ({ output: "sessions", restart: false }) });
    const cli = new AgentCLI(
      { process: async (): Promise<string> => { orchestratorCalls += 1; return "unexpected"; } },
      new AgentUI((text: string): void => { outputs.push(text); }),
      new TerminalState(),
      reader,
      router,
      { providerConfigured: false },
    );

    await cli.start();
    expect(orchestratorCalls).toBe(0);
    expect(reader.prompts[0]).toBe("oden [no provider]> ");
    expect(outputs.filter((output): boolean => output.includes("No provider configured"))).toHaveLength(2);
    expect(outputs).toContain("status");
    expect(outputs).toContain("help");
    expect(outputs).toContain("sessions");
  });

  it("returns restart when a slash command requests a pipeline rebuild", async (): Promise<void> => {
    const outputs: string[] = [];
    const router = new SlashCommandRouter();
    router.register({ name: "provider", description: "Configure provider", execute: async () => ({ output: "saved", restart: true }) });
    const cli = new AgentCLI(
      { process: async (): Promise<string> => "unused" },
      new AgentUI((text: string): void => { outputs.push(text); }),
      new TerminalState(),
      new QueueReader(["/provider"]),
      router,
      { providerConfigured: false },
    );
    expect(await cli.start()).toBe("restart");
    expect(outputs).toContain("saved");
    expect(outputs).toContain("Restarting Oden with the saved provider configuration...");
    expect(outputs).not.toContain("Goodbye.");
  });
});
