import { z } from "zod";
import type { LLMProvider } from "../providers/LLMProvider.js";
import type { FunctionCall } from "../providers/LLMResponse.js";
import type { ToolDefinition } from "../tools/ToolRegistry.js";
import type { Message } from "./Message.js";
import { RESEARCH_AGENT_SYSTEM_PROMPT } from "./ResearchAgentSystemPrompt.js";

export interface ResearchBrief {
  readonly summary: string;
  readonly keyFindings: string[];
  readonly sources: Array<{ readonly title: string; readonly url: string }>;
}

const RESEARCH_BRIEF_SCHEMA = z.object({
  summary: z.string(),
  keyFindings: z.array(z.string()),
  sources: z.array(z.object({ title: z.string(), url: z.string().url() })),
});

const MAX_RESEARCH_STEPS = 5;

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

function sourceRecords(searchOutput: string): Array<{ title: string; url: string }> {
  const records: Array<{ title: string; url: string }> = [];
  const pattern = /^\d+\.\s*(.+)\n\s+(https:\/\/\S+)/gm;
  let match: RegExpExecArray | null = pattern.exec(searchOutput);
  while (match !== null) {
    records.push({ title: (match[1] ?? "Source").trim(), url: (match[2] ?? "").trim() });
    match = pattern.exec(searchOutput);
  }
  return records;
}

function briefFromText(text: string, searchOutputs: readonly string[]): ResearchBrief {
  try {
    return RESEARCH_BRIEF_SCHEMA.parse(JSON.parse(text) as unknown);
  } catch {
    const findings = text.split("\n").map((line): string => line.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
    const sources = searchOutputs.flatMap(sourceRecords);
    return {
      summary: text.trim() || "Research completed without a summary.",
      keyFindings: findings,
      sources: sources.filter((source, index): boolean => sources.findIndex((candidate): boolean => candidate.url === source.url) === index),
    };
  }
}

export class ResearchAgent {
  public constructor(
    private readonly provider: LLMProvider,
    private readonly searchTool: ToolDefinition,
  ) {}

  public async run(query: string): Promise<ResearchBrief> {
    const messages: Message[] = [
      { role: "user", parts: [{ text: RESEARCH_AGENT_SYSTEM_PROMPT }] },
      { role: "user", parts: [{ text: `Research this question: ${query}` }] },
    ];
    const searchOutputs: string[] = [];
    for (let step = 0; step < MAX_RESEARCH_STEPS; step += 1) {
      const response = await this.provider.generateContent(messages, [this.searchTool]);
      const calls = response.functionCalls ?? [];
      if (calls.length === 0) {
        return briefFromText(response.text ?? "", searchOutputs);
      }
      messages.push(modelMessage(response.text, calls));
      for (const call of calls) {
        let result: string;
        if (call.name !== this.searchTool.name) {
          result = `Error: ResearchAgent is restricted to the '${this.searchTool.name}' tool`;
        } else {
          try {
            result = await this.searchTool.execute(call.args);
          } catch (error: unknown) {
            result = `Search tool failed: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        searchOutputs.push(result);
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
    return briefFromText("Research step limit reached before a final synthesis was returned.", searchOutputs);
  }
}
