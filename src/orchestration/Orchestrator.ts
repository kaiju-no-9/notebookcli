import type { AgentResult } from "../agent/Agent.js";
import type { Message } from "../agent/Message.js";
import type { ResearchBrief } from "../agent/ResearchAgent.js";
import type { RunCallbacks } from "../agent/RunCallbacks.js";
import type { GuardrailContext } from "../guardrails/types/GuardrailContext.js";
import type { GuardrailResult } from "../guardrails/types/GuardrailResult.js";
import type { LLMProvider } from "../providers/LLMProvider.js";
import type { ClassificationResult } from "./Supervisor.js";
import { SecretScanner } from "../guardrails/types/SecretScanner.js";
import { RunBudgetError, RunContext } from "../utils/RunContext.js";
import type { RunLimits } from "../config/RunLimits.js";

export interface AgentService {
  run(input: string, systemPrompt: string, maxSteps?: number, runContext?: RunContext): Promise<AgentResult>;
}

export interface ResearchAgentService {
  run(query: string, runContext?: RunContext): Promise<ResearchBrief>;
}

export interface StreamingService {
  stream(messages: Message[], onToken: (token: string) => void, runContext?: RunContext): Promise<string>;
}

export interface SupervisorService {
  classify(input: string, history: Message[], runContext?: RunContext): Promise<ClassificationResult>;
}

export interface GuardrailService {
  check(context: GuardrailContext): Promise<GuardrailResult>;
}

export interface DirectMemoryTools {
  save(key: string, value: string): Promise<string>;
  search(query: string): Promise<string>;
}

export type HistoryPersistence = (history: readonly Message[]) => Promise<void>;

type MemoryIntent =
  | { readonly kind: "save"; readonly value: string }
  | { readonly kind: "search"; readonly query: string };

const CODING_SYSTEM_PROMPT = `You are Oden, a careful software engineering agent. Inspect relevant project instructions before making changes, preserve existing work, use project conventions, and verify changes with the requested checks. When the user explicitly asks you to remember a fact or preference, use save_memory; when they ask you to recall saved information, use search_memory. Explain any blockers accurately.`;

function isMemoryToolRequest(input: string): boolean {
  return /\b(?:remember|recall|memory|supermemory)\b/i.test(input);
}

function parseDirectMemoryIntent(input: string): MemoryIntent | undefined {
  const saveMatch = /^\s*(?:please\s+)?remember\s+(?:(?:that|this|for me)\s*:?\s*)?(.+?)\s*[.!]?\s*$/i.exec(input);
  if (saveMatch?.[1] !== undefined && saveMatch[1].trim().length > 0) {
    return { kind: "save", value: saveMatch[1].trim() };
  }
  if (/^(?:what|which|tell me|please|can you|could you|recall|search|find)\b/i.test(input.trim()) && /\b(?:remember|recall|memory|saved|stored)\b/i.test(input)) {
    return { kind: "search", query: input.trim() };
  }
  if (/^recall\b/i.test(input.trim())) {
    return { kind: "search", query: input.trim() };
  }
  return undefined;
}

export class Orchestrator {
  private readonly history: Message[];

  public constructor(
    private readonly provider: LLMProvider,
    private readonly streaming: StreamingService,
    private readonly agent: AgentService,
    private readonly researchAgent: ResearchAgentService,
    private readonly inputGuardrails: GuardrailService,
    private readonly outputGuardrails: GuardrailService,
    private readonly supervisor: SupervisorService,
    private readonly callbacks?: RunCallbacks,
    private readonly directMemoryTools?: DirectMemoryTools,
    initialHistory: readonly Message[] = [],
    private readonly persistHistory?: HistoryPersistence,
    private readonly runLimits?: RunLimits,
  ) {
    this.history = [...structuredClone(initialHistory)];
  }

  public getHistory(): Message[] {
    return structuredClone(this.history);
  }

  public setHistory(history: readonly Message[]): void {
    this.history.splice(0, this.history.length, ...structuredClone(history));
  }

  public async process(input: string): Promise<string> {
    const runContext = this.runLimits === undefined ? undefined : new RunContext(this.runLimits);
    const memoryIntent = parseDirectMemoryIntent(input);
    if (memoryIntent !== undefined && this.directMemoryTools !== undefined) {
      runContext?.recordToolInvocation();
      const response = await this.executeDirectMemoryIntent(memoryIntent);
      this.history.push(
        { role: "user", parts: [{ text: input }] },
        { role: "model", parts: [{ text: response }] },
      );
      return this.saveHistoryOrWarn(response);
    }

    let inputCheck: GuardrailResult;
    try {
      inputCheck = await this.inputGuardrails.check({ userMessage: input, conversationHistory: this.getHistory(), runContext });
    } catch (error: unknown) {
      return `I can't process that because the input safety check failed: ${this.errorMessage(error)}`;
    }
    if (!inputCheck.allowed) {
      return `I can't process that: ${inputCheck.reason}`;
    }

    let classification: ClassificationResult;
    try {
      classification = await this.supervisor.classify(input, this.getHistory(), runContext);
    } catch (error: unknown) {
      if (error instanceof RunBudgetError) return `I couldn't complete the request: ${error.message}`;
      classification = { route: "CODE_ONLY", reasoning: "Supervisor failed; using coding agent fallback.", confidence: 0 };
    }
    if (isMemoryToolRequest(input)) {
      classification = { route: "CODE_ONLY", reasoning: "Memory requests require the memory tools.", confidence: 1 };
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
            (token: string): void => { streamedTokens.push(token); }, runContext,
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
          brief = await this.researchAgent.run(input, runContext);
        } catch (error: unknown) {
          if (error instanceof RunBudgetError) {
            response = `I couldn't complete the request: ${error.message}`;
            break;
          }
          this.callbacks?.onStatus?.("Research failed; continuing with coding agent...");
          response = await this.runCodingAgent(input, runContext);
          break;
        }
        this.callbacks?.onStatus?.("Starting coding agent with research...");
        response = await this.runCodingAgent(this.withResearch(input, brief), runContext);
        break;
      }
      case "CODE_ONLY":
      default:
        this.callbacks?.onStatus?.("Starting coding agent...");
        response = await this.runCodingAgent(input, runContext);
        break;
    }

    let outputCheck: GuardrailResult;
    try {
      outputCheck = await this.outputGuardrails.check({ userMessage: response, runContext });
    } catch (error: unknown) {
      if (error instanceof RunBudgetError) {
        response = `${response}\n\n[Output classifier skipped: ${error.message}]`;
        outputCheck = { allowed: true, reason: "Budget reached before output check", confidence: 0, stage: "budget" };
      } else {
        outputCheck = { allowed: false, reason: `Output safety check failed: ${this.errorMessage(error)}`, confidence: 1, stage: "guard_error" };
      }
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
    return this.saveHistoryOrWarn(response);
  }

  private async saveHistoryOrWarn(response: string): Promise<string> {
    try {
      await this.persistHistory?.(this.getHistory());
      return response;
    } catch (error: unknown) {
      return `${response}\n\n[Session history could not be saved: ${this.errorMessage(error)}]`;
    }
  }

  private async executeDirectMemoryIntent(intent: MemoryIntent): Promise<string> {
    try {
      const response = intent.kind === "save"
        ? await this.directMemoryTools?.save(`oden-memory-${Date.now()}`, intent.value)
        : await this.directMemoryTools?.search(intent.query);
      if (response === undefined) {
        return "Memory tools are not available.";
      }
      if (intent.kind === "search" && SecretScanner.containsSecrets(response)) {
        return "Memory search results were blocked because they appear to contain credentials.";
      }
      return response;
    } catch (error: unknown) {
      return `Memory operation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async runCodingAgent(input: string, runContext?: RunContext): Promise<string> {
    try {
      return (await this.agent.run(input, CODING_SYSTEM_PROMPT, undefined, runContext)).response;
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
