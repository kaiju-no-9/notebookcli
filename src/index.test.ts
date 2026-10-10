import { describe, expect, it } from "bun:test";
import { createProgram, createApplication, createToolRegistry } from "./index.js";
import { OpenRouterConfig } from "./providers/OpenRouterConfig.js";

describe("CLI entry point", (): void => {
  it("exports without starting the application and parses a model override", (): void => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["node", "oden", "--model", "provider/model"]);
    expect(program.opts<{ model: string }>().model).toBe("provider/model");
    expect(typeof createApplication).toBe("function");
    expect(OpenRouterConfig.DEFAULT_MODEL).toBe("openrouter/free");
    const defaultProgram = createProgram();
    defaultProgram.parse(["node", "oden"]);
    expect(defaultProgram.opts<{ model: string }>().model).toBe(OpenRouterConfig.DEFAULT_MODEL);
    expect(createToolRegistry().getNames()).toEqual([
      "coding_context_tool", "code_tool", "get_project_tree", "execute_command",
      "git_command", "search", "save_memory", "search_memory",
    ]);
  });
});
