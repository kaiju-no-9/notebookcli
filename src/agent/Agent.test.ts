import { describe, expect, it } from "bun:test";
import { Agent } from "./Agent.js";
import { AgentMode } from "./AgentMode.js";
import { FakeLLM } from "./FakeLLM.js";
import type { LLMResponse } from "../providers/LLMResponse.js";
import { ToolRegistry, type ToolDefinition } from "../tools/ToolRegistry.js";
import { z } from "zod";

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
    const provider = new FakeLLM([response("plan"), response("completed")]);
    const result = await new Agent(provider, registryWithTool()).run("do work", "system");
    expect(result).toMatchObject({ response: "completed", steps: 1, mode: AgentMode.ACT, toolCalls: [] });
  });

  it("executes approved tool calls and appends tool results before continuing", async (): Promise<void> => {
    let executions = 0;
    const tool = makeTool(async (): Promise<string> => { executions += 1; return "changed file"; });
    const provider = new FakeLLM([
      response("inspect first"),
      response(null, [{ name: "test_tool", args: { value: "x" } }]),
      response("approved"),
      response("check the result"),
      response("all done"),
    ]);
    const result = await new Agent(provider, registryWithTool(tool)).run("make a change", "system");
    expect(executions).toBe(1);
    expect(result.toolCalls[0]).toMatchObject({ name: "test_tool", result: "changed file" });
    expect(provider.calls[0]?.tools).toEqual([]);
    expect(provider.calls[1]?.tools?.map((entry): string => entry.name)).toEqual(["test_tool"]);
    expect(provider.calls[3]?.messages.at(-1)).toEqual({
      role: "tool",
      parts: [{ functionResponse: { name: "test_tool", response: "changed file" } }],
    });
    expect(result).toMatchObject({ response: "all done", steps: 2 });
  });

  it("does not execute tool calls rejected by plan reflection and respects maxSteps", async (): Promise<void> => {
    let executions = 0;
    const tool = makeTool(async (): Promise<string> => { executions += 1; return "should not run"; });
    const call = response(null, [{ name: "test_tool", args: { value: "x" } }]);
    const provider = new FakeLLM([
      response("plan one"), call, response("rejected"),
      response("plan two"), call, response("not approved"),
    ]);
    const result = await new Agent(provider, registryWithTool(tool)).run("request", "system", 2);
    expect(executions).toBe(0);
    expect(result.steps).toBe(2);
    expect(result.response).toContain("Step limit reached");
  });

  it("turns tool errors into results and reports plan and act status", async (): Promise<void> => {
    const statuses: string[] = [];
    const tool = makeTool(async (): Promise<string> => { throw new Error("disk unavailable"); });
    const provider = new FakeLLM([
      response("plan"), response(null, [{ name: "test_tool", args: { value: "x" } }]), response("approved"),
      response("recover"), response("finished"),
    ]);
    const result = await new Agent(provider, registryWithTool(tool), { onStatus: (status: string): void => { statuses.push(status); } }).run("request", "system");
    expect(result.toolCalls[0]?.result).toContain("disk unavailable");
    expect(result.response).toBe("finished");
    expect(statuses).toEqual(["Planning step 1", "Acting step 1", "Planning step 2", "Acting step 2"]);
  });
});
