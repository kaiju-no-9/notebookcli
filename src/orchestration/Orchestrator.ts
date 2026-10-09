import type { AgentResult } from "../agent/Agent.js";
import type { Message } from "../agent/Message.js";
import type { ResearchBrief } from "../agent/ResearchAgent.js";
import type { RunCallbacks } from "../agent/RunCallbacks.js";
import type { GuardrailContext } from "../guardrails/types/GuardrailContext.js";
import type { GuardrailResult } from "../guardrails/types/GuardrailResult.js";
import type { LLMProvider } from "../providers/LLMProvider.js";
import type { ClassificationResult } from "./Supervisor.js";

export interface AgentService {
  run(input: string, systemPrompt: string, maxSteps?: number): Promise<AgentResult>;
}

export interface ResearchAgentService {
  run(query: string): Promise<ResearchBrief>;
}

export interface StreamingService {
  stream(messages: Message[], onToken: (token: string) => void): Promise<string>;
}

export interface SupervisorService {
  classify(input: string, history: Message[]): Promise<ClassificationResult>;
}

export interface GuardrailService {
  check(context: GuardrailContext): Promise<GuardrailResult>;
}

const CODING_SYSTEM_PROMPT = `You are Oden, a careful software engineering agent. Inspect relevant project instructions before making changes, preserve existing work, use project conventions, and verify changes with the requested checks. Explain any blockers accurately.`;

export class Orchestrator {
  private readonly history: Message[] = [];

  public constructor(
    private readonly provider: LLMProvider,
    private readonly streaming: StreamingService,
    private readonly agent: AgentService,
    private readonly researchAgent: ResearchAgentService,
    private readonly inputGuardrails: GuardrailService,
    private readonly outputGuardrails: GuardrailService,
    private readonly supervisor: SupervisorService,
    private readonly callbacks?: RunCallbacks,
  ) {
  }

  public getHistory(): Message[] {
    return structuredClone(this.history);
  }

  public async process(input: string): Promise<string> {
    let inputCheck: GuardrailResult;
    try {
      inputCheck = await this.inputGuardrails.check({ userMessage: input, conversationHistory: this.getHistory() });
    } catch (error: unknown) {
      return `I can't process that because the input safety check failed: ${this.errorMessage(error)}`;
    }
    if (!inputCheck.allowed) {
      return `I can't process that: ${inputCheck.reason}`;
    }

    let classification: ClassificationResult;
    try {
      classification = await this.supervisor.classify(input, this.getHistory());
    } catch {
      classification = { route: "CODE_ONLY", reasoning: "Supervisor failed; using coding agent fallback.", confidence: 0 };
    }

    const userMessage: Message = { role: "user", parts: [{ text: input }] };
    let response: string;
    let streamedTokens: string[] = [];
    switch (classification.route) {
      case "DIRECT": {
        this.callbacks?.onStatus?.("Streaming response...");
        streamedTokens = [];
        try {
          response = await this.streaming.stream(
            [...this.getHistory(), userMessage],
            (token: string): void => { streamedTokens.push(token); },
          );
        } catch (error: unknown) {
          response = `I couldn't complete a direct response: ${this.errorMessage(error)}`;
          streamedTokens = [];
        }
        break;
      }
      case "RESEARCH_AND_CODE": {
        this.callbacks?.onStatus?.("Researching...");
        let brief: ResearchBrief;
        try {
          brief = await this.researchAgent.run(input);
        } catch {
          this.callbacks?.onStatus?.("Research failed; continuing with coding agent...");
          response = await this.runCodingAgent(input);
          break;
        }
        this.callbacks?.onStatus?.("Starting coding agent with research...");
        response = await this.runCodingAgent(this.withResearch(input, brief));
        break;
      }
      case "CODE_ONLY":
      default:
        this.callbacks?.onStatus?.("Starting coding agent...");
        response = await this.runCodingAgent(input);
        break;
    }

    let outputCheck: GuardrailResult;
    try {
      outputCheck = await this.outputGuardrails.check({ userMessage: response });
    } catch (error: unknown) {
      outputCheck = { allowed: false, reason: `Output safety check failed: ${this.errorMessage(error)}`, confidence: 1, stage: "guard_error" };
    }
    if (!outputCheck.allowed) {
      response = `Response was filtered: ${outputCheck.reason}`;
      streamedTokens = [];
    } else {
      for (const token of streamedTokens) {
        this.callbacks?.onToken?.(token);
      }
    }

    this.history.push(userMessage, { role: "model", parts: [{ text: response }] });
    return response;
  }

  private async runCodingAgent(input: string): Promise<string> {
    try {
      return (await this.agent.run(input, CODING_SYSTEM_PROMPT)).response;
    } catch (error: unknown) {
      return `I couldn't complete the coding request: ${this.errorMessage(error)}`;
    }
  }

  private withResearch(input: string, brief: ResearchBrief): string {
    const findings = brief.keyFindings.map((finding): string => `- ${finding}`).join("\n");
    const sources = brief.sources.map((source): string => `- ${source.title}: ${source.url}`).join("\n");
    return `${input}\n\nResearch brief:\n${brief.summary}${findings.length === 0 ? "" : `\n\nKey findings:\n${findings}`}${sources.length === 0 ? "" : `\n\nSources:\n${sources}`}`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
