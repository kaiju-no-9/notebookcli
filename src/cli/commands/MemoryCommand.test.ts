import { describe, expect, it } from "bun:test";
import { MemoryCommand } from "./MemoryCommand.js";
import type { SetupPrompts } from "./SetupPrompts.js";

function prompts(apiKey: string): SetupPrompts {
  return {
    chooseProvider: async () => "gemini",
    enterSecret: async () => apiKey,
    chooseModel: async () => "model",
    enterText: async () => "",
  };
}

describe("MemoryCommand", (): void => {
  it("connects Supermemory from its hidden API key prompt without restarting", async (): Promise<void> => {
    const stored: Array<[string, string]> = [];
    const command = new MemoryCommand({ set: async (key, value): Promise<void> => { stored.push([key, value]); } }, prompts("sm_test_credential"));
    expect(await command.execute()).toEqual({ output: "Supermemory connected. Memory tools are now active.", restart: false });
    expect(stored).toEqual([
      ["SUPERMEMORY_API_KEY", "sm_test_credential"],
      ["MEMORY_API_URL", "https://api.supermemory.ai/v3"],
    ]);
  });

  it("does not change settings when the key prompt is left blank", async (): Promise<void> => {
    let writes = 0;
    const command = new MemoryCommand({ set: async (): Promise<void> => { writes += 1; } }, prompts(""));
    expect((await command.execute()).output).toContain("Memory setup cancelled");
    expect(writes).toBe(0);
  });
});
