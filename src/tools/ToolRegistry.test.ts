import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ToolRegistry, type ToolDefinition } from "./ToolRegistry.js";

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} test tool`,
    parameters: z.object({ value: z.string() }),
    execute: async (): Promise<string> => `${name} executed`,
  };
}

describe("ToolRegistry", (): void => {
  it("registers a tool and retrieves it by name", (): void => {
    const registry = new ToolRegistry();
    const tool = makeTool("read_file");

    registry.register(tool);

    expect(registry.get("read_file")).toBe(tool);
  });

  it("returns undefined for an unknown tool", (): void => {
    expect(new ToolRegistry().get("missing")).toBeUndefined();
  });

  it("returns registered tools in registration order", (): void => {
    const registry = new ToolRegistry();
    const first = makeTool("first");
    const second = makeTool("second");

    registry.register(first);
    registry.register(second);

    expect(registry.getAll()).toEqual([first, second]);
  });

  it("returns registered tool names in registration order", (): void => {
    const registry = new ToolRegistry();

    registry.register(makeTool("first"));
    registry.register(makeTool("second"));

    expect(registry.getNames()).toEqual(["first", "second"]);
  });
});
