import { ConfigManager } from "../../config/ConfigManager.js";
import { getModelsForProvider, type ProviderType } from "../../config/ModelCatalog.js";
import type { SlashCommandHandler, SlashCommandResult } from "../SlashCommandRouter.js";
import { inquirerSetupPrompts, isPromptCancelled, type SetupPrompts } from "./SetupPrompts.js";

export interface ProviderCommandConfig {
  readonly provider?: ProviderType;
  readonly model?: string;
}

export interface ProviderCommandStore {
  has(key: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
}

export class ProviderCommand implements SlashCommandHandler {
  public readonly name = "provider";
  public readonly description = "Configure LLM provider, API key, and model";

  public constructor(
    private readonly current: ProviderCommandConfig,
    private readonly store: ProviderCommandStore = ConfigManager,
    private readonly prompts: SetupPrompts = inquirerSetupPrompts,
  ) {}

  public async execute(): Promise<SlashCommandResult> {
    try {
      const currentDescription = this.current.provider === undefined
        ? "Choose your LLM provider:"
        : `Currently using: ${this.current.provider}${this.current.model === undefined ? "" : ` (${this.current.model})`}. Choose a provider:`;
      const provider = await this.prompts.chooseProvider(currentDescription);
      const keyName = provider === "gemini" ? "GEMINI_API_KEY" : "OPENROUTER_API_KEY";
      let apiKey: string | undefined;
      if (!await this.store.has(keyName)) {
        apiKey = (await this.prompts.enterSecret(
          provider === "gemini" ? "Enter your Gemini API key (starts with AIza or AQ.):" : "Enter your OpenRouter API key (starts with sk-or-):",
        )).trim();
        if (!this.isValidApiKey(provider, apiKey)) {
          return {
            output: provider === "gemini"
              ? "Gemini API keys must start with 'AIza' or 'AQ.'. No settings were changed."
              : "OpenRouter API keys must start with 'sk-or-'. No settings were changed.",
            restart: false,
          };
        }
      }
      const model = await this.prompts.chooseModel(getModelsForProvider(provider));
      if (!getModelsForProvider(provider).some((option): boolean => option.id === model)) {
        return { output: "The selected model is not in the available model list. No settings were changed.", restart: false };
      }

      // Save credentials first and the active selection last so startup never sees a provider without its key.
      if (apiKey !== undefined) {
        await this.store.set(keyName, apiKey);
      }
      await this.store.set("ODEN_MODEL", model);
      await this.store.set("ODEN_PROVIDER", provider);
      return { output: `Provider set to ${provider} (${model}). Restarting Oden...`, restart: true };
    } catch (error: unknown) {
      if (isPromptCancelled(error)) {
        return { output: "Provider setup cancelled. Current settings were not changed.", restart: false };
      }
      return { output: `Provider setup failed: ${error instanceof Error ? error.message : String(error)}`, restart: false };
    }
  }

  private isValidApiKey(provider: ProviderType, apiKey: string): boolean {
    return provider === "gemini" ? /^(?:AIza\S{8,}|AQ\.\S{8,})$/.test(apiKey) : /^sk-or-\S{8,}$/.test(apiKey);
  }
}
