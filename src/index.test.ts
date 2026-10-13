import { describe, expect, it } from "bun:test";
import { createProgram, createApplication, createReadOnlySpecialistRegistry, createToolRegistry } from "./index.js";
import { OpenRouterConfig } from "./providers/OpenRouterConfig.js";

describe("CLI entry point", (): void => {
  it("exports without starting the application and parses a model override", (): void => {
    const program = createProgram();
    program.exitOverride();
    program.parse(["node", "oden", "--provider", "gemini", "--model", "gemini-test-model", "--workspace", "/tmp/oden-test"]);
    expect(program.opts<{ provider: string; model: string }>().provider).toBe("gemini");
    expect(program.opts<{ provider: string; model: string }>().model).toBe("gemini-test-model");
    expect(program.opts<{ workspace: string }>().workspace).toBe("/tmp/oden-test");
    expect(typeof createApplication).toBe("function");
    expect(OpenRouterConfig.DEFAULT_MODEL).toBe("openrouter/free");
    const defaultProgram = createProgram();
    defaultProgram.parse(["node", "oden"]);
    expect(defaultProgram.opts<{ provider?: string; model?: string }>().provider).toBeUndefined();
    expect(defaultProgram.opts<{ provider: string; model?: string }>().model).toBeUndefined();
    expect(createToolRegistry().getNames()).toEqual([
      "coding_context_tool", "code_tool", "get_project_tree", "execute_command",
      "git_command", "search", "save_memory", "search_memory",
    ]);
    expect(createReadOnlySpecialistRegistry("repo_inspector").getNames()).toEqual(["coding_context_tool", "get_project_tree"]);
    expect(createReadOnlySpecialistRegistry("test_planner").getNames()).toEqual(["coding_context_tool", "get_project_tree"]);
    expect(createReadOnlySpecialistRegistry("documentation_researcher").getNames()).toEqual(["search"]);
  });
});
