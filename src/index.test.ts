import { describe, expect, it } from "bun:test";
import { createProgram, createApplication, createToolRegistry } from "./index.js";

describe("CLI entry point", (): void => {
  it("exports without starting the application and parses a model override", (): void => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["node", "oden", "--model", "gemini-test"]);
    expect(program.opts<{ model: string }>().model).toBe("gemini-test");
    expect(typeof createApplication).toBe("function");
    expect(createToolRegistry().getNames()).toEqual([
      "coding_context_tool", "code_tool", "get_project_tree", "execute_command",
      "git_command", "search", "save_memory", "search_memory",
    ]);
  });
});
