import { ConfigManager } from "../../config/ConfigManager.js";
import type { SlashCommandHandler, SlashCommandResult } from "../SlashCommandRouter.js";
import { inquirerSetupPrompts, isPromptCancelled, type SetupPrompts } from "./SetupPrompts.js";

export interface WebCommandStore {
  set(key: string, value: string): Promise<void>;
}

export class WebCommand implements SlashCommandHandler {
  public readonly name = "web";
  public readonly description = "Configure a Tavily API key for web search";

  public constructor(
    private readonly store: WebCommandStore = ConfigManager,
    private readonly prompts: SetupPrompts = inquirerSetupPrompts,
  ) {}

  public async execute(): Promise<SlashCommandResult> {
    try {
      const key = (await this.prompts.enterSecret("Enter your Tavily API key (leave empty to skip):")).trim();
      if (key.length === 0) {
        return { output: "Tavily setup skipped. Web search will use its available fallback providers.", restart: false };
      }
      await this.store.set("TAVILY_API_KEY", key);
      return { output: "Tavily API key saved. Web search will use Tavily when available.", restart: false };
    } catch (error: unknown) {
      if (isPromptCancelled(error)) {
        return { output: "Web search setup cancelled. Current settings were not changed.", restart: false };
      }
      return { output: `Web search setup failed: ${error instanceof Error ? error.message : String(error)}`, restart: false };
    }
  }
}
