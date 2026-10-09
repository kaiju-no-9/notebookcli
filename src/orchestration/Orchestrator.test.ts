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
