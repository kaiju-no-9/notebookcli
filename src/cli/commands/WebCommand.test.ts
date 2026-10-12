import { describe, expect, it } from "bun:test";
import { WebCommand } from "./WebCommand.js";
import type { SetupPrompts } from "./SetupPrompts.js";

describe("WebCommand", (): void => {
  it("stores Tavily credentials without requesting an application restart", async (): Promise<void> => {
    const stored: Array<[string, string]> = [];
    const prompts: SetupPrompts = {
      chooseProvider: async () => "gemini",
      enterSecret: async () => "tvly-test-key",
      chooseModel: async () => "model",
      enterText: async () => "",
    };
    const command = new WebCommand({ set: async (key, value): Promise<void> => { stored.push([key, value]); } }, prompts);
    expect(await command.execute()).toEqual({ output: "Tavily API key saved. Web search will use Tavily when available.", restart: false });
    expect(stored).toEqual([["TAVILY_API_KEY", "tvly-test-key"]]);
  });

  it("leaves settings unchanged when the optional key is blank", async (): Promise<void> => {
    let writes = 0;
    const prompts: SetupPrompts = {
      chooseProvider: async () => "gemini",
      enterSecret: async () => "",
      chooseModel: async () => "model",
      enterText: async () => "",
    };
    const command = new WebCommand({ set: async (): Promise<void> => { writes += 1; } }, prompts);
    expect((await command.execute()).output).toContain("skipped");
    expect(writes).toBe(0);
  });
});
