import { describe, expect, it } from "bun:test";
import type { AgentResult } from "../agent/Agent.js";
import { AgentMode } from "../agent/AgentMode.js";
import type { Message } from "../agent/Message.js";
import type { ResearchBrief } from "../agent/ResearchAgent.js";
import type { RunCallbacks } from "../agent/RunCallbacks.js";
import { FakeLLM } from "../agent/FakeLLM.js";
import type { GuardrailResult } from "../guardrails/types/GuardrailResult.js";
import { Orchestrator, type AgentService, type GuardrailService, type ResearchAgentService, type StreamingService, type SupervisorService } from "./Orchestrator.js";
import { RouteDecision, type ClassificationResult } from "./Supervisor.js";
import type { RunLimits } from "../config/RunLimits.js";

function agentResult(response: string): AgentResult {
  return { response, steps: 1, toolCalls: [], mode: AgentMode.ACT };
}

function guard(allowed: boolean, reason = "policy decision"): GuardrailService {
  return { check: async (): Promise<GuardrailResult> => ({ allowed, reason, confidence: 1, stage: "test" }) };
}

function supervisor(route: ClassificationResult["route"]): SupervisorService {
  return { classify: async (): Promise<ClassificationResult> => ({ route, reasoning: "test", confidence: 1 }) };
}

function research(brief: ResearchBrief, order: string[]): ResearchAgentService {
  return { run: async (): Promise<ResearchBrief> => { order.push("research"); return brief; } };
}

function emptyProvider(): FakeLLM {
  return new FakeLLM([]);
}

describe("Orchestrator", (): void => {
  it("blocks unsafe input before classification or route execution", async (): Promise<void> => {
    let classified = false;
    const classifying: SupervisorService = { classify: async (): Promise<ClassificationResult> => {
      classified = true;
      return { route: RouteDecision.DIRECT, reasoning: "", confidence: 1 };
    } };
    const orchestrator = new Orchestrator(
      emptyProvider(), { stream: async (): Promise<string> => "" }, { run: async (): Promise<AgentResult> => agentResult("") },
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      guard(false, "secret detected"), guard(true), classifying,
    );
    expect(await orchestrator.process("contains a secret")).toBe("I can't process that: secret detected");
    expect(classified).toBe(false);
  });

  it("routes DIRECT through streaming and releases tokens only after output approval", async (): Promise<void> => {
    const order: string[] = [];
    const delivered: string[] = [];
    let outputGuardSawDeliveredTokens = -1;
    const streaming: StreamingService = {
      stream: async (messages: Message[], onToken: (token: string) => void): Promise<string> => {
        order.push("stream");
        expect(messages.at(-1)?.parts[0]).toEqual({ text: "hello" });
        onToken("Hello");
        onToken(" there");
        return "Hello there";
      },
    };
    const outputCheck: GuardrailService = { check: async (): Promise<GuardrailResult> => {
      order.push("output");
      outputGuardSawDeliveredTokens = delivered.length;
      return { allowed: true, reason: "safe", confidence: 1, stage: "test" };
    } };
    const callbacks: RunCallbacks = { onToken: (token: string): void => { delivered.push(token); } };
    const orchestrator = new Orchestrator(
      emptyProvider(), streaming, { run: async (): Promise<AgentResult> => agentResult("") },
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      guard(true), outputCheck, supervisor(RouteDecision.DIRECT), callbacks,
    );
    expect(await orchestrator.process("hello")).toBe("Hello there");
    expect(order).toEqual(["stream", "output"]);
    expect(outputGuardSawDeliveredTokens).toBe(0);
    expect(delivered).toEqual(["Hello", " there"]);
  });

  it("shares one run context across classifiers, routing, streaming, and output checks", async (): Promise<void> => {
    const contexts: unknown[] = [];
    const runLimits: RunLimits = { maxLLMRequests: 8, maxToolInvocations: 8, maxDurationMs: 10_000, maxTokens: 10_000, maxOutputTokens: 128, maxRetries: 0, maxRetryDelayMs: 0 };
    const contextGuard: GuardrailService = { check: async (context): Promise<GuardrailResult> => {
      contexts.push(context.runContext);
      return { allowed: true, reason: "ok", confidence: 1, stage: "test" };
    } };
    const orchestrator = new Orchestrator(
      emptyProvider(), { stream: async (_messages, _onToken, runContext): Promise<string> => { contexts.push(runContext); return "ok"; } },
      { run: async (): Promise<AgentResult> => agentResult("unused") },
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      contextGuard, contextGuard,
      { classify: async (_input, _history, runContext): Promise<ClassificationResult> => { contexts.push(runContext); return { route: RouteDecision.DIRECT, reasoning: "", confidence: 1 }; } },
      undefined, undefined, [], undefined, runLimits,
    );
    await orchestrator.process("answer directly");
    expect(contexts).toHaveLength(4);
    expect(contexts.every((context): boolean => context === contexts[0] && context !== undefined)).toBe(true);
  });

  it("routes CODE_ONLY through Agent and accumulates conversation history", async (): Promise<void> => {
    const inputs: string[] = [];
    const agent: AgentService = { run: async (input: string): Promise<AgentResult> => {
      inputs.push(input);
      return agentResult(`done ${inputs.length}`);
    } };
    const inputGuard: GuardrailService = { check: async (context): Promise<GuardrailResult> => {
      expect(context.conversationHistory?.length ?? 0).toBe(inputs.length * 2);
      return { allowed: true, reason: "ok", confidence: 1, stage: "test" };
    } };
    const orchestrator = new Orchestrator(
      emptyProvider(), { stream: async (): Promise<string> => "unexpected" }, agent,
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      inputGuard, guard(true), supervisor(RouteDecision.CODE_ONLY),
    );
    expect(await orchestrator.process("task one")).toBe("done 1");
    expect(await orchestrator.process("task two")).toBe("done 2");
    expect(inputs).toEqual(["task one", "task two"]);
    expect(orchestrator.getHistory()).toHaveLength(4);
  });

  it("restores initial session history and persists each completed turn", async (): Promise<void> => {
    const persisted: Message[][] = [];
    const initial: Message[] = [{ role: "user", parts: [{ text: "Earlier task" }] }];
    const orchestrator = new Orchestrator(
      emptyProvider(), { stream: async (): Promise<string> => "hello" },
      { run: async (): Promise<AgentResult> => agentResult("done") },
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      guard(true), guard(true), supervisor(RouteDecision.DIRECT), undefined, undefined,
      initial, async (history): Promise<void> => { persisted.push([...history]); },
    );

    expect(orchestrator.getHistory()).toEqual(initial);
    expect(await orchestrator.process("new task")).toBe("hello");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toHaveLength(3);
  });

  it("replaces the active conversation history when switching sessions", async (): Promise<void> => {
    const orchestrator = new Orchestrator(
      emptyProvider(), { stream: async (): Promise<string> => "" }, { run: async (): Promise<AgentResult> => agentResult("") },
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      guard(true), guard(true), supervisor(RouteDecision.DIRECT),
    );
    const replacement: Message[] = [{ role: "user", parts: [{ text: "Another task" }] }];

    orchestrator.setHistory(replacement);

    expect(orchestrator.getHistory()).toEqual(replacement);
  });

  it("routes explicit memory requests through the tool-enabled Agent path", async (): Promise<void> => {
    let agentInput = "";
    let streamCalls = 0;
    const orchestrator = new Orchestrator(
      emptyProvider(),
      { stream: async (): Promise<string> => { streamCalls += 1; return "unexpected direct response"; } },
      { run: async (input: string): Promise<AgentResult> => { agentInput = input; return agentResult("memory handled"); } },
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      guard(true), guard(true), supervisor(RouteDecision.DIRECT),
    );

    expect(await orchestrator.process("Remember that my test tag is violet-42.")).toBe("memory handled");
    expect(agentInput).toBe("Remember that my test tag is violet-42.");
    expect(streamCalls).toBe(0);
  });

  it("executes explicit remember requests directly without calling the LLM pipeline", async (): Promise<void> => {
    const saved: Array<[string, string]> = [];
    let guardCalls = 0;
    let supervisorCalls = 0;
    let agentCalls = 0;
    const orchestrator = new Orchestrator(
      emptyProvider(),
      { stream: async (): Promise<string> => "unexpected stream" },
      { run: async (): Promise<AgentResult> => { agentCalls += 1; return agentResult("unexpected agent"); } },
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      { check: async (): Promise<GuardrailResult> => { guardCalls += 1; return { allowed: true, reason: "ok", confidence: 1, stage: "test" }; } },
      guard(true),
      { classify: async (): Promise<ClassificationResult> => { supervisorCalls += 1; return { route: RouteDecision.DIRECT, reasoning: "simple", confidence: 1 }; } },
      undefined,
      { save: async (key, value): Promise<string> => { saved.push([key, value]); return "Memory saved for testing."; }, search: async (): Promise<string> => "" },
    );

    expect(await orchestrator.process("remember that I do not like to code in rust .")).toBe("Memory saved for testing.");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.[1]).toBe("I do not like to code in rust");
    expect(guardCalls).toBe(0);
    expect(supervisorCalls).toBe(0);
    expect(agentCalls).toBe(0);
  });

  it("does not route web searches to Supermemory", async (): Promise<void> => {
    let agentInput = "";
    let memorySearchCalls = 0;
    const orchestrator = new Orchestrator(
      emptyProvider(),
      { stream: async (): Promise<string> => "unexpected direct response" },
      { run: async (input: string): Promise<AgentResult> => { agentInput = input; return agentResult("Web results returned."); } },
      { run: async (): Promise<ResearchBrief> => ({ summary: "Bun release findings", keyFindings: [], sources: [] }) },
      guard(true), guard(true), supervisor(RouteDecision.RESEARCH_AND_CODE), undefined,
      { save: async (): Promise<string> => "unexpected save", search: async (): Promise<string> => { memorySearchCalls += 1; return "unexpected memory result"; } },
    );

    expect(await orchestrator.process("Search the web for the latest Bun release and give me the source links.")).toBe("Web results returned.");
    expect(agentInput).toContain("Search the web for the latest Bun release");
    expect(agentInput).toContain("Bun release findings");
    expect(memorySearchCalls).toBe(0);
  });

  it("runs ResearchAgent before Agent and passes the research brief", async (): Promise<void> => {
    const order: string[] = [];
    const brief: ResearchBrief = { summary: "Research summary", keyFindings: ["Finding"], sources: [{ title: "Docs", url: "https://example.com" }] };
    const agent: AgentService = { run: async (input: string): Promise<AgentResult> => {
      order.push("agent");
      expect(input).toContain("Research summary");
      expect(input).toContain("https://example.com");
      return agentResult("implemented");
    } };
    const orchestrator = new Orchestrator(
      emptyProvider(), { stream: async (): Promise<string> => "" }, agent, research(brief, order),
      guard(true), guard(true), supervisor(RouteDecision.RESEARCH_AND_CODE),
    );
    expect(await orchestrator.process("build this using current docs")).toBe("implemented");
    expect(order).toEqual(["research", "agent"]);
  });

  it("filters unsafe output and defaults to CODE_ONLY if Supervisor throws", async (): Promise<void> => {
    let agentCalls = 0;
    const agent: AgentService = { run: async (): Promise<AgentResult> => { agentCalls += 1; return agentResult("unsafe output"); } };
    const failedSupervisor: SupervisorService = { classify: async (): Promise<ClassificationResult> => { throw new Error("provider failed"); } };
    const orchestrator = new Orchestrator(
      emptyProvider(), { stream: async (): Promise<string> => "" }, agent,
      { run: async (): Promise<ResearchBrief> => ({ summary: "", keyFindings: [], sources: [] }) },
      guard(true), guard(false, "secret in output"), failedSupervisor,
    );
    expect(await orchestrator.process("write code")).toBe("Response was filtered: secret in output");
    expect(agentCalls).toBe(1);
    expect(orchestrator.getHistory().at(-1)?.parts[0]).toEqual({ text: "Response was filtered: secret in output" });
  });

  it("falls back to CODE_ONLY if research fails", async (): Promise<void> => {
    let agentInput = "";
    const orchestrator = new Orchestrator(
      emptyProvider(), { stream: async (): Promise<string> => "" },
      { run: async (input: string): Promise<AgentResult> => { agentInput = input; return agentResult("fallback complete"); } },
      { run: async (): Promise<ResearchBrief> => { throw new Error("search unavailable"); } },
      guard(true), guard(true), supervisor(RouteDecision.RESEARCH_AND_CODE),
    );
    expect(await orchestrator.process("implement feature")).toBe("fallback complete");
    expect(agentInput).toBe("implement feature");
  });
});
