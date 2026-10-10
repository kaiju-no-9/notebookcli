import { AgentMode } from "./AgentMode.js";
import type { Message } from "./Message.js";
import type { RunCallbacks } from "./RunCallbacks.js";
import type { LLMProvider } from "../providers/LLMProvider.js";
import type { FunctionCall } from "../providers/LLMResponse.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";

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
    parts.push({ functionCall: { ...(call.id === undefined ? {} : { id: call.id }), name: call.name, args: call.args } });
  }
  return { role: "model", parts };
}

export class Agent {
  public constructor(
    private readonly provider: LLMProvider,
    private readonly tools: ToolRegistry,
    private readonly callbacks?: RunCallbacks,
    private readonly reflectionEnabled: boolean = true,
  ) {}

  public async run(input: string, systemPrompt: string, maxSteps: number = 60): Promise<AgentResult> {
    const messages: Message[] = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "user", parts: [{ text: input }] },
    ];
    const toolCalls: ToolCallRecord[] = [];
    const stepLimit = Number.isFinite(maxSteps) ? Math.max(0, Math.floor(maxSteps)) : 60;
    let lastResponse = "";

    for (let step = 1; step <= stepLimit; step += 1) {
      this.callbacks?.onStatus?.(`Planning step ${step}`);
      const plan = await this.provider.generateContent(messages, []);
      if (plan.text !== null) {
        lastResponse = plan.text;
        if (plan.text.length > 0) {
          messages.push(modelMessage(plan.text));
        }
      }

      this.callbacks?.onStatus?.(`Acting step ${step}`);
      const act = await this.provider.generateContent(messages, this.tools.getAll());
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
      if (this.reflectionEnabled && !(await this.planReflection(calls, messages))) {
        messages.push({ role: "model", parts: [{ text: "Reconsidering the proposed tool calls and planning a safer approach." }] });
        continue;
      }

      for (const call of calls) {
        const tool = this.tools.get(call.name);
        let result: string;
        if (tool === undefined) {
          result = `Error: tool '${call.name}' is not registered`;
        } else {
          try {
            result = await tool.execute(call.args);
          } catch (error: unknown) {
            result = `Error executing tool '${call.name}': ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        toolCalls.push({ name: call.name, args: structuredClone(call.args), result, timestamp: Date.now() });
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

  private async planReflection(calls: readonly FunctionCall[], messages: readonly Message[]): Promise<boolean> {
    const reflectionMessages: Message[] = [
      ...messages,
      {
        role: "user",
        parts: [{ text: `Review these proposed tool calls for relevance and safety: ${JSON.stringify(calls)}. Reply with "approved" only if each call is appropriate; otherwise explain that it is rejected.` }],
      },
    ];
    const response = await this.provider.generateContent(reflectionMessages, []);
    const text = response.text?.toLowerCase() ?? "";
    if (/\b(reject(?:ed)?|denied|unsafe|not approved)\b/.test(text)) {
      return false;
    }
    return /\bapproved\b|\bproceed\b/.test(text);
  }
}
