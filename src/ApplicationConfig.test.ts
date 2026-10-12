import { describe, expect, it } from "bun:test";
import { ProviderCommand } from "./cli/commands/ProviderCommand.js";
import type { ApplicationConfigStore } from "./index.js";
import { resolveApplicationConfig } from "./index.js";

function createStore(
  stored: Readonly<Record<string, string>> = {},
  environment: Readonly<Record<string, string>> = {},
): ApplicationConfigStore {
  return {
    has: async (key: string): Promise<boolean> => stored[key] !== undefined || environment[key] !== undefined,
    get: async (key: string): Promise<string> => {
      const value = environment[key] ?? stored[key];
      if (value === undefined) {
        throw new Error(`Missing ${key}`);
      }
      return value;
    },
    getStored: async (key: string): Promise<string | undefined> => stored[key],
  };
}

describe("resolveApplicationConfig", (): void => {
  it("lets CLI arguments override persisted provider and model settings", async (): Promise<void> => {
    const config = await resolveApplicationConfig({ provider: "openrouter", model: "cli-model" }, createStore({
      ODEN_PROVIDER: "gemini",
      ODEN_MODEL: "stored-model",
      GEMINI_API_KEY: "gemini-key",
      OPENROUTER_API_KEY: "router-key",
    }));
    expect(config).toEqual({
      provider: "openrouter",
      model: "cli-model",
      apiKey: "router-key",
      providerConfigured: true,
    });
  });

  it("uses the new provider's default model when only CLI provider overrides saved provider", async (): Promise<void> => {
    const config = await resolveApplicationConfig({ provider: "openrouter" }, createStore({
      ODEN_PROVIDER: "gemini",
      ODEN_MODEL: "gemini-3.8-flash",
      GEMINI_API_KEY: "gemini-key",
      OPENROUTER_API_KEY: "router-key",
    }));
    expect(config.provider).toBe("openrouter");
    expect(config.model).toBe("openrouter/free");
    expect(config.apiKey).toBe("router-key");
  });

  it("lets a persisted slash-command choice override an environment default", async (): Promise<void> => {
    const config = await resolveApplicationConfig({}, createStore({
      ODEN_PROVIDER: "gemini",
      ODEN_MODEL: "gemini-picked-model",
      GEMINI_API_KEY: "gemini-key",
    }, {
      ODEN_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "router-key",
    }));
    expect(config.provider).toBe("gemini");
    expect(config.model).toBe("gemini-picked-model");
    expect(config.apiKey).toBe("gemini-key");
    expect(config.providerConfigured).toBe(true);
  });

  it("enters config-only mode when neither provider nor key is configured", async (): Promise<void> => {
    expect(await resolveApplicationConfig({}, createStore())).toEqual({ provider: undefined, model: undefined, apiKey: undefined, providerConfigured: false });
  });

  it("keeps existing API-key-only setups working with OpenRouter as the preferred default", async (): Promise<void> => {
    const config = await resolveApplicationConfig({}, createStore({}, {
      OPENROUTER_API_KEY: "router-key",
      GEMINI_API_KEY: "gemini-key",
    }));
    expect(config.provider).toBe("openrouter");
    expect(config.model).toBe("openrouter/free");
    expect(config.apiKey).toBe("router-key");
  });

  it("round-trips provider setup into the configuration used after restart", async (): Promise<void> => {
    const values: Record<string, string> = {};
    const store: ApplicationConfigStore & { set(key: string, value: string): Promise<void> } = {
      has: async (key: string): Promise<boolean> => values[key] !== undefined,
      get: async (key: string): Promise<string> => values[key] ?? "",
      getStored: async (key: string): Promise<string | undefined> => values[key],
      set: async (key: string, value: string): Promise<void> => { values[key] = value; },
    };
    const command = new ProviderCommand({}, store, {
      chooseProvider: async () => "gemini",
      enterSecret: async () => "AIza1234567890",
      chooseModel: async (models) => models[0]?.id ?? "",
      enterText: async () => "",
    });

    expect((await command.execute()).restart).toBe(true);
    expect(await resolveApplicationConfig({}, store)).toEqual({
      provider: "gemini",
      model: "gemini-3.8-flash",
      apiKey: "AIza1234567890",
      providerConfigured: true,
    });
  });
});
