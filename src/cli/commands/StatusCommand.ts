import { ConfigManager } from "../../config/ConfigManager.js";
import type { SlashCommandHandler, SlashCommandResult } from "../SlashCommandRouter.js";
import type { ProviderCommandConfig } from "./ProviderCommand.js";

export interface StatusCommandConfigStore {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<string>;
}

export interface StatusCommandCurrent extends ProviderCommandConfig {
  readonly workspace?: string;
}

function redact(value: string): string {
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function optionalValue(store: StatusCommandConfigStore, key: string): Promise<string | undefined> {
  return await store.has(key) ? store.get(key) : undefined;
}

export class StatusCommand implements SlashCommandHandler {
  public readonly name = "status";
  public readonly description = "Show current provider and configured services";

  public constructor(
    private readonly current: StatusCommandCurrent,
    private readonly store: StatusCommandConfigStore = ConfigManager,
  ) {}

  public async execute(): Promise<SlashCommandResult> {
    try {
      const provider = this.current.provider;
      const model = this.current.model;
      const credential = provider === "gemini"
        ? await optionalValue(this.store, "GEMINI_API_KEY")
        : provider === "openrouter" ? await optionalValue(this.store, "OPENROUTER_API_KEY") : undefined;
      const tavily = await this.store.has("TAVILY_API_KEY");
      const memoryURL = await this.store.has("MEMORY_API_URL");
      const supermemoryKey = await this.store.has("SUPERMEMORY_API_KEY");
      const lines = [
        "Oden Configuration",
        `Provider: ${provider ?? "Not configured"}`,
        `Model: ${model ?? "Not configured"}`,
        `Workspace: ${this.current.workspace ?? "Not configured"}`,
        `API key: ${credential === undefined ? "Not configured" : `${redact(credential)} (configured)`}`,
        `Web search: ${tavily ? "Tavily configured ✓" : "Fallback search ○"}`,
        `Memory: ${memoryURL ? (supermemoryKey ? "Supermemory configured ✓" : "Configured ✓") : "Not configured"}`,
      ];
      return { output: lines.join("\n"), restart: false };
    } catch (error: unknown) {
      return { output: `Could not read configuration status: ${error instanceof Error ? error.message : String(error)}`, restart: false };
    }
  }
}
