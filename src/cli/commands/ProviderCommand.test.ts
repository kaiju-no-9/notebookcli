import { describe, expect, it } from "bun:test";
import type { ModelOption, ProviderType } from "../../config/ModelCatalog.js";
import { ProviderCommand } from "./ProviderCommand.js";
import type { SetupPrompts } from "./SetupPrompts.js";

function fakePrompts(overrides: Partial<SetupPrompts> = {}): SetupPrompts {
  return {
    chooseProvider: async (): Promise<ProviderType> => "gemini",
    enterSecret: async (): Promise<string> => "AIza1234567890",
    chooseModel: async (models: readonly ModelOption[]): Promise<string> => models[0]?.id ?? "",
    enterText: async (): Promise<string> => "",
    ...overrides,
  };
}

describe("ProviderCommand", (): void => {
  it("stores a validated provider, key, and curated model before requesting restart", async (): Promise<void> => {
    const stored: Array<[string, string]> = [];
    const command = new ProviderCommand(
      {},
      {
        has: async (): Promise<boolean> => false,
        set: async (key, value): Promise<void> => { stored.push([key, value]); },
      },
      fakePrompts(),
    );
    expect(await command.execute()).toEqual({
      output: "Provider set to gemini (gemini-3.8-flash). Restarting Oden...",
      restart: true,
    });
    expect(stored).toEqual([
      ["GEMINI_API_KEY", "AIza1234567890"],
      ["ODEN_MODEL", "gemini-3.8-flash"],
      ["ODEN_PROVIDER", "gemini"],
    ]);
  });

  it("accepts and stores a new-format Gemini AQ authorization key", async (): Promise<void> => {
    const stored: Array<[string, string]> = [];
    const apiKey = "AQ.Ab8MockOnlyKey0123456789ABCDEF";
    const command = new ProviderCommand(
      {},
      {
        has: async (): Promise<boolean> => false,
        set: async (key, value): Promise<void> => { stored.push([key, value]); },
      },
      fakePrompts({ enterSecret: async (): Promise<string> => apiKey }),
    );

    expect(await command.execute()).toEqual({
      output: "Provider set to gemini (gemini-3.8-flash). Restarting Oden...",
      restart: true,
    });
    expect(stored[0]).toEqual(["GEMINI_API_KEY", apiKey]);
  });

  it("stores an OpenRouter key and its free router model", async (): Promise<void> => {
    const stored: Array<[string, string]> = [];
    const command = new ProviderCommand(
      {},
      {
        has: async (): Promise<boolean> => false,
        set: async (key, value): Promise<void> => { stored.push([key, value]); },
      },
      fakePrompts({
        chooseProvider: async (): Promise<ProviderType> => "openrouter",
        enterSecret: async (): Promise<string> => "sk-or-1234567890",
      }),
    );

    expect(await command.execute()).toEqual({
      output: "Provider set to openrouter (openrouter/free). Restarting Oden...",
      restart: true,
    });
    expect(stored).toEqual([
      ["OPENROUTER_API_KEY", "sk-or-1234567890"],
      ["ODEN_MODEL", "openrouter/free"],
      ["ODEN_PROVIDER", "openrouter"],
    ]);
  });

  it("reuses an existing provider key when selecting another model", async (): Promise<void> => {
    const stored: Array<[string, string]> = [];
    let secretPrompted = false;
    const command = new ProviderCommand(
      { provider: "gemini", model: "gemini-3.8-flash" },
      {
        has: async (key): Promise<boolean> => key === "GEMINI_API_KEY",
        set: async (key, value): Promise<void> => { stored.push([key, value]); },
      },
      fakePrompts({
        enterSecret: async (): Promise<string> => { secretPrompted = true; throw new Error("Should not prompt when a key exists"); },
        chooseModel: async (): Promise<string> => "gemini-3.5-flash-lite",
      }),
    );

    expect(await command.execute()).toEqual({
      output: "Provider set to gemini (gemini-3.5-flash-lite). Restarting Oden...",
      restart: true,
    });
    expect(secretPrompted).toBe(false);
    expect(stored).toEqual([
      ["ODEN_MODEL", "gemini-3.5-flash-lite"],
      ["ODEN_PROVIDER", "gemini"],
    ]);
  });

  it("does not store an invalid API key", async (): Promise<void> => {
    let writes = 0;
    const command = new ProviderCommand(
      {},
      { has: async (): Promise<boolean> => false, set: async (): Promise<void> => { writes += 1; } },
      fakePrompts({ enterSecret: async (): Promise<string> => "not-a-key" }),
    );
    const result = await command.execute();
    expect(result.restart).toBe(false);
    expect(result.output).toContain("must start with 'AIza' or 'AQ.'");
    expect(writes).toBe(0);
  });

  it("returns to the REPL when prompt selection is cancelled", async (): Promise<void> => {
    const cancellation = new Error("cancelled");
    cancellation.name = "ExitPromptError";
    const command = new ProviderCommand(
      {},
      { has: async (): Promise<boolean> => false, set: async (): Promise<void> => undefined },
      fakePrompts({ chooseProvider: async (): Promise<ProviderType> => { throw cancellation; } }),
    );
    expect(await command.execute()).toEqual({
      output: "Provider setup cancelled. Current settings were not changed.",
      restart: false,
    });
  });
});
