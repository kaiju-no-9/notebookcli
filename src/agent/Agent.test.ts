import { describe, expect, it } from "bun:test";
import { Agent } from "./Agent.js";
import { AgentMode } from "./AgentMode.js";
import { FakeLLM } from "./FakeLLM.js";
import type { LLMResponse } from "../providers/LLMResponse.js";
import { ToolRegistry, type ToolDefinition } from "../tools/ToolRegistry.js";
import { z } from "zod";
import { loadRunLimits } from "../config/RunLimits.js";
import { RunContext } from "../utils/RunContext.js";
import type { LLMProvider } from "../providers/LLMProvider.js";

function response(text: string | null, functionCalls: LLMResponse["functionCalls"] = null): LLMResponse {
  return { text, functionCalls, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
}

function makeTool(execute: (args: unknown) => Promise<string> = async (): Promise<string> => "tool result"): ToolDefinition {
  return { name: "test_tool", description: "A test tool", parameters: z.object({ value: z.string() }), execute };
}

function registryWithTool(tool: ToolDefinition = makeTool()): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(tool);
  return registry;
}

describe("Agent", (): void => {
  it("completes when the act response contains only text", async (): Promise<void> => {
    const provider = new FakeLLM([response("completed")]);
    const result = await new Agent(provider, registryWithTool()).run("do work", "system");
    expect(result).toMatchObject({ response: "completed", steps: 1, mode: AgentMode.ACT, toolCalls: [] });
    expect(provider.calls).toHaveLength(1);
  });

  it("uses tool-enabled streaming and forwards text chunks as they arrive", async (): Promise<void> => {
    const tokens: string[] = [];
    let streamed = false;
    const provider: LLMProvider = {
      generateContent: async (): Promise<LLMResponse> => response("buffered"),
      streamContent: async (): Promise<string> => "unused",
      streamGenerateContent: async (_messages, tools, onToken): Promise<LLMResponse> => {
        streamed = true;
        expect(tools?.map((tool): string => tool.name)).toEqual(["test_tool"]);
        onToken("Streamed ");
        onToken("answer");
        return response("Streamed answer");
      },
    };
    const result = await new Agent(provider, registryWithTool(), { onToken: (token: string): void => { tokens.push(token); } }).run("do work", "system");

    expect(streamed).toBe(true);
    expect(tokens).toEqual(["Streamed ", "answer"]);
    expect(result.response).toBe("Streamed answer");
  });

  it("executes approved tool calls and appends tool results before continuing", async (): Promise<void> => {
    let executions = 0;
    const tool = makeTool(async (): Promise<string> => { executions += 1; return "changed file"; });
    const provider = new FakeLLM([
      response(null, [{ id: "call-test-1", name: "test_tool", args: { value: "x" }, thoughtSignature: "signature-test-1" }]),
      response("all done"),
    ]);
    const result = await new Agent(provider, registryWithTool(tool)).run("make a change", "system");
    expect(executions).toBe(1);
    expect(result.toolCalls[0]).toMatchObject({ name: "test_tool", result: "changed file" });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.tools?.map((entry): string => entry.name)).toEqual(["test_tool"]);
    expect(provider.calls[1]?.messages.at(-1)).toEqual({
      role: "tool",
      parts: [{ functionResponse: { toolCallId: "call-test-1", name: "test_tool", response: "changed file" } }],
    });
    expect(provider.calls[1]?.messages[2]).toEqual({
      role: "model",
      parts: [{ functionCall: {
        id: "call-test-1",
        name: "test_tool",
        args: { value: "x" },
        thoughtSignature: "signature-test-1",
      } }],
    });
    expect(result).toMatchObject({ response: "all done", steps: 2 });
  });

  it("runs one model request per step and respects maxSteps", async (): Promise<void> => {
    let executions = 0;
    const tool = makeTool(async (): Promise<string> => { executions += 1; return "should not run"; });
    const call = response(null, [{ name: "test_tool", args: { value: "x" } }]);
    const provider = new FakeLLM([call, call]);
    const result = await new Agent(provider, registryWithTool(tool)).run("request", "system", 2);
    expect(executions).toBe(2);
    expect(result.steps).toBe(2);
    expect(result.response).toContain("Step limit reached");
  });

  it("turns tool errors into results and reports plan and act status", async (): Promise<void> => {
    const statuses: string[] = [];
    const tool = makeTool(async (): Promise<string> => { throw new Error("disk unavailable"); });
    const provider = new FakeLLM([
      response(null, [{ name: "test_tool", args: { value: "x" } }]), response("finished"),
    ]);
    const result = await new Agent(provider, registryWithTool(tool), { onStatus: (status: string): void => { statuses.push(status); } }).run("request", "system");
    expect(result.toolCalls[0]?.result).toContain("disk unavailable");
    expect(result.response).toBe("finished");
    expect(statuses).toEqual(["Acting step 1", "Acting step 2"]);
  });

  it("stops after the same failing tool call repeats", async (): Promise<void> => {
    const failedCall = response(null, [{ name: "test_tool", args: { value: "x" } }]);
    const provider = new FakeLLM([failedCall, failedCall]);
    const tool = makeTool(async (): Promise<string> => { throw new Error("missing file"); });
    const result = await new Agent(provider, registryWithTool(tool)).run("request", "system");
    expect(result.response).toContain("same tool call failed 2 times");
    expect(provider.calls).toHaveLength(2);
  });

  it("passes the run ID and injected approval service to tool execution", async (): Promise<void> => {
    let receivedRunId = "";
    let receivedApproval = false;
    const tool = makeTool(async (): Promise<string> => "done");
    const contextualTool: ToolDefinition = {
      ...tool,
      execute: async (_args, context): Promise<string> => {
        receivedRunId = context?.runId ?? "";
        receivedApproval = context?.approvalService !== undefined;
        return "done";
      },
    };
    const provider = new FakeLLM([
      response(null, [{ name: "test_tool", args: { value: "x" } }]), response("finished"),
    ]);
    const approvalService = { requestApproval: async (): Promise<{ status: "denied" }> => ({ status: "denied" }) };
    const runContext = new RunContext(loadRunLimits());
    await new Agent(provider, registryWithTool(contextualTool), undefined, false, approvalService).run("request", "system", undefined, runContext);
    expect(receivedRunId).toBe(runContext.runId);
    expect(receivedApproval).toBe(true);
  });
});
