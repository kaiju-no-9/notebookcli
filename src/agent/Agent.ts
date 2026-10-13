import { AgentMode } from "./AgentMode.js";
import type { Message } from "./Message.js";
import type { RunCallbacks } from "./RunCallbacks.js";
import type { LLMProvider } from "../providers/LLMProvider.js";
import type { FunctionCall } from "../providers/LLMResponse.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import type { RunContext } from "../utils/RunContext.js";
import { RunBudgetError } from "../utils/RunContext.js";
import type { ApprovalService } from "../tools/Approval.js";

export interface ToolCallRecord {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result: string;
  readonly timestamp: number;
}

export interface AgentResult {
  readonly response: string;
  readonly steps: number;
  readonly toolCalls: ToolCallRecord[];
  readonly mode: AgentMode;
}

function modelMessage(text: string | null, calls: readonly FunctionCall[] = []): Message {
  const parts: Message["parts"] = [];
  if (text !== null && text.length > 0) {
    parts.push({ text });
  }
  for (const call of calls) {
    parts.push({ functionCall: {
      ...(call.id === undefined ? {} : { id: call.id }),
      name: call.name,
      args: call.args,
      ...(call.thoughtSignature === undefined ? {} : { thoughtSignature: call.thoughtSignature }),
    } });
  }
  return { role: "model", parts };
}

export class Agent {
  public constructor(
    private readonly provider: LLMProvider,
    private readonly tools: ToolRegistry,
    private readonly callbacks?: RunCallbacks,
    private readonly planningEnabled: boolean = false,
    private readonly approvalService?: ApprovalService,
  ) {}

  public async run(input: string, systemPrompt: string, maxSteps: number = 60, runContext?: RunContext): Promise<AgentResult> {
    const messages: Message[] = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "user", parts: [{ text: input }] },
    ];
    const toolCalls: ToolCallRecord[] = [];
    const repeatedFailures = new Map<string, number>();
    const stepLimit = Number.isFinite(maxSteps) ? Math.max(0, Math.floor(maxSteps)) : 60;
    let lastResponse = "";

    for (let step = 1; step <= stepLimit; step += 1) {
      if (this.planningEnabled && step === 1) {
        this.callbacks?.onStatus?.("Planning...");
        const plan = await this.provider.generateContent(messages, [], undefined, runContext);
        if (plan.text !== null) {
          lastResponse = plan.text;
          if (plan.text.length > 0) messages.push(modelMessage(plan.text));
        }
      }

      this.callbacks?.onStatus?.(`Acting step ${step}`);
      const act = await this.provider.generateContent(messages, this.tools.getAll(), undefined, runContext);
      if (act.text !== null && act.text.length > 0) {
        lastResponse = act.text;
      }
      const calls = act.functionCalls ?? [];
      if (calls.length === 0) {
        if (act.text !== null && act.text.length > 0) {
          return { response: act.text, steps: step, toolCalls, mode: AgentMode.ACT };
        }
        continue;
      }

      messages.push(modelMessage(act.text, calls));
      for (const call of calls) {
        runContext?.recordToolInvocation();
        const tool = this.tools.get(call.name);
        let result: string;
        if (tool === undefined) {
          result = `Error: tool '${call.name}' is not registered`;
        } else {
          try {
            const parsedArgs = tool.parameters.safeParse(call.args);
            if (!parsedArgs.success) {
              result = `Error: invalid arguments for '${call.name}': ${parsedArgs.error.message}`;
              messages.push({ role: "tool", parts: [{ functionResponse: { ...(call.id === undefined ? {} : { toolCallId: call.id }), name: call.name, response: result } }] });
              toolCalls.push({ name: call.name, args: structuredClone(call.args), result, timestamp: Date.now() });
              continue;
            }
            result = await tool.execute(parsedArgs.data, {
              runId: runContext?.runId ?? "untracked-run",
              ...(this.approvalService === undefined ? {} : { approvalService: this.approvalService }),
            });
          } catch (error: unknown) {
            if (error instanceof RunBudgetError) throw error;
            result = `Error executing tool '${call.name}': ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        toolCalls.push({ name: call.name, args: structuredClone(call.args), result, timestamp: Date.now() });
        const failureKey = `${call.name}:${canonicalize(call.args)}`;
        if (/^Error(?: executing tool|:)/.test(result)) {
          const failures = (repeatedFailures.get(failureKey) ?? 0) + 1;
          repeatedFailures.set(failureKey, failures);
          if (failures >= 2) {
            return {
              response: `Stopped after the same tool call failed ${failures} times (${call.name}). Review the error and adjust the request before retrying.`,
              steps: step,
              toolCalls,
              mode: AgentMode.ACT,
            };
          }
        } else {
          repeatedFailures.delete(failureKey);
        }
        messages.push({
          role: "tool",
          parts: [{ functionResponse: {
            ...(call.id === undefined ? {} : { toolCallId: call.id }),
            name: call.name,
            response: result,
          } }],
        });
      }
    }

    return {
      response: stepLimit === 0
        ? "Step limit reached before the agent started."
        : `Step limit reached before a final response.${lastResponse.length === 0 ? "" : ` Last response: ${lastResponse}`}`,
      steps: stepLimit,
      toolCalls,
      mode: AgentMode.ACT,
    };
  }

}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]): number => left.localeCompare(right));
    return `{${entries.map(([key, entry]): string => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
