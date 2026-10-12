import { ConfigManager } from "../../config/ConfigManager.js";
import type { SlashCommandHandler, SlashCommandResult } from "../SlashCommandRouter.js";
import { isPromptCancelled } from "./SetupPrompts.js";

const API_CREDENTIALS = [
  { key: "GEMINI_API_KEY", label: "Gemini API key" },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter API key" },
  { key: "SUPERMEMORY_API_KEY", label: "Supermemory API key" },
  { key: "TAVILY_API_KEY", label: "Tavily API key" },
] as const;

export interface DeleteCommandStore {
  getStored(key: string): Promise<string | undefined>;
  delete(key: string): Promise<void>;
}

export interface DeleteCommandPrompts {
  chooseCredential(options: readonly { readonly key: string; readonly label: string }[]): Promise<string>;
}

const inquirerDeletePrompt: DeleteCommandPrompts = {
  chooseCredential: async (options): Promise<string> => {
    const { select } = await import("@inquirer/prompts");
    return select({
      message: "Choose a saved API key to delete:",
      choices: options.map((option): { value: string; name: string } => ({ value: option.key, name: option.label })),
    });
  },
};

export class DeleteCommand implements SlashCommandHandler {
  public readonly name = "delete";
  public readonly description = "Delete a saved provider or service API key";

  public constructor(
    private readonly store: DeleteCommandStore = ConfigManager,
    private readonly prompts: DeleteCommandPrompts = inquirerDeletePrompt,
  ) {}

  public async execute(): Promise<SlashCommandResult> {
    try {
      const available = await Promise.all(API_CREDENTIALS.map(async (credential) =>
        (await this.store.getStored(credential.key)) === undefined ? undefined : credential,
      ));
      const options = available.filter((credential): credential is typeof API_CREDENTIALS[number] => credential !== undefined);
      if (options.length === 0) {
        return {
          output: "No saved API keys found. Use /provider, /memory, or /web to add one.",
          restart: false,
        };
      }

      const selectedKey = await this.prompts.chooseCredential(options);
      const selected = options.find((option): boolean => option.key === selectedKey);
      if (selected === undefined) {
        return { output: "No API key was deleted because the selection was invalid.", restart: false };
      }

      await this.store.delete(selected.key);
      if (selected.key === "SUPERMEMORY_API_KEY") {
        await this.store.delete("MEMORY_API_URL");
      }
      const replacementCommand = selected.key === "GEMINI_API_KEY" || selected.key === "OPENROUTER_API_KEY"
        ? "/provider"
        : selected.key === "SUPERMEMORY_API_KEY" ? "/memory" : "/web";
      return {
        output: `${selected.label} deleted. Use ${replacementCommand} to add a replacement.`,
        restart: selected.key === "GEMINI_API_KEY" || selected.key === "OPENROUTER_API_KEY",
      };
    } catch (error: unknown) {
      if (isPromptCancelled(error)) {
        return { output: "API key deletion cancelled. No key was deleted.", restart: false };
      }
      return { output: `Could not delete the API key: ${error instanceof Error ? error.message : String(error)}`, restart: false };
    }
  }
}
