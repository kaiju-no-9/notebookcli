import { ConfigManager } from "../../config/ConfigManager.js";
import type { SlashCommandHandler, SlashCommandResult } from "../SlashCommandRouter.js";
import { inquirerSetupPrompts, isPromptCancelled, type SetupPrompts } from "./SetupPrompts.js";

const SUPERMEMORY_API_URL = "https://api.supermemory.ai/v3";

export interface MemoryCommandStore {
  set(key: string, value: string): Promise<void>;
}

export class MemoryCommand implements SlashCommandHandler {
  public readonly name = "memory";
  public readonly description = "Connect Supermemory using its API key";

  public constructor(
    private readonly store: MemoryCommandStore = ConfigManager,
    private readonly prompts: SetupPrompts = inquirerSetupPrompts,
  ) {}

  public async execute(): Promise<SlashCommandResult> {
    try {
      const apiKey = (await this.prompts.enterSecret("Enter your Supermemory API key (hidden):")).trim();
      if (apiKey.length === 0) {
        return { output: "Memory setup cancelled. No settings were changed.", restart: false };
      }
      await this.store.set("SUPERMEMORY_API_KEY", apiKey);
      await this.store.set("MEMORY_API_URL", SUPERMEMORY_API_URL);
      return { output: "Supermemory connected. Memory tools are now active.", restart: false };
    } catch (error: unknown) {
      if (isPromptCancelled(error)) {
        return { output: "Memory setup cancelled. No settings were changed.", restart: false };
      }
      return { output: `Memory setup failed: ${error instanceof Error ? error.message : String(error)}`, restart: false };
    }
  }
}
