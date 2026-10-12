import { describe, expect, it } from "bun:test";
import { StatusCommand } from "./StatusCommand.js";

describe("StatusCommand", (): void => {
  it("shows active configuration and masks credentials", async (): Promise<void> => {
    const values: Record<string, string> = {
      OPENROUTER_API_KEY: "sk-or-v1-1234567890abcdef",
      TAVILY_API_KEY: "tvly-key",
    };
    const command = new StatusCommand({ provider: "openrouter", model: "openrouter/free" }, {
      has: async (key): Promise<boolean> => values[key] !== undefined,
      get: async (key): Promise<string> => values[key] ?? "",
    });
    const output = (await command.execute()).output;
    expect(output).toContain("Provider: openrouter");
    expect(output).toContain("Model: openrouter/free");
    expect(output).toContain("sk-o…cdef");
    expect(output).not.toContain("1234567890abcdef");
    expect(output).toContain("Web search: Tavily configured");
    expect(output).toContain("Memory: Not configured");
  });

  it("shows missing provider and services without prompting", async (): Promise<void> => {
    const command = new StatusCommand({}, { has: async (): Promise<boolean> => false, get: async (): Promise<string> => "" });
    const output = (await command.execute()).output;
    expect(output).toContain("Provider: Not configured");
    expect(output).toContain("API key: Not configured");
    expect(output).toContain("Fallback search");
    expect(output).toContain("Memory: Not configured");
  });

  it("reports Supermemory configured without showing its API key", async (): Promise<void> => {
    const secret = "sm_test_secret_key";
    const command = new StatusCommand({}, {
      has: async (key): Promise<boolean> => key === "MEMORY_API_URL" || key === "SUPERMEMORY_API_KEY",
      get: async (key): Promise<string> => key === "SUPERMEMORY_API_KEY" ? secret : "",
    });
    const output = (await command.execute()).output;
    expect(output).toContain("Memory: Supermemory configured");
    expect(output).not.toContain(secret);
  });
});
