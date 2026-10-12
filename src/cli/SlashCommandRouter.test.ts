import { describe, expect, it } from "bun:test";
import { SlashCommandRouter, type SlashCommandHandler } from "./SlashCommandRouter.js";

function handler(name: string, output: string): SlashCommandHandler {
  return { name, description: `${name} command`, execute: async () => ({ output, restart: false }) };
}

describe("SlashCommandRouter", (): void => {
  it("detects slash-prefixed input after leading whitespace", (): void => {
    const router = new SlashCommandRouter();
    expect(router.isSlashCommand(" /help ")).toBe(true);
    expect(router.isSlashCommand("help me")).toBe(false);
  });

  it("dispatches commands by case-insensitive command name", async (): Promise<void> => {
    const router = new SlashCommandRouter();
    router.register(handler("help", "help text"));
    expect(await router.dispatch("/HELP")).toEqual({ output: "help text", restart: false });
  });

  it("dispatches class-based handlers without losing their prototype methods", async (): Promise<void> => {
    class ClassHandler {
      public readonly name = "class-handler";
      public readonly description = "A class handler";
      public async execute(): Promise<{ output: string; restart: boolean }> {
        return { output: "class handler ran", restart: false };
      }
    }
    const router = new SlashCommandRouter();
    router.register(new ClassHandler());
    await expect(router.dispatch("/class-handler")).resolves.toEqual({ output: "class handler ran", restart: false });
  });

  it("returns a useful error and command list for unknown commands", async (): Promise<void> => {
    const router = new SlashCommandRouter();
    router.register(handler("help", "help text"));
    expect(await router.dispatch("/unknown")).toEqual({
      output: "Unknown command '/unknown'. Available commands: /help",
      restart: false,
    });
  });

  it("rejects duplicate command registration", (): void => {
    const router = new SlashCommandRouter();
    router.register(handler("help", "help text"));
    expect((): void => router.register(handler("HELP", "other"))).toThrow("already registered");
  });
});
