import type { ModelOption, ProviderType } from "../../config/ModelCatalog.js";

export interface SetupPrompts {
  chooseProvider(message: string): Promise<ProviderType>;
  enterSecret(message: string): Promise<string>;
  chooseModel(models: readonly ModelOption[]): Promise<string>;
  enterText(message: string): Promise<string>;
}

export const inquirerSetupPrompts: SetupPrompts = {
  chooseProvider: async (message: string): Promise<ProviderType> => {
    const { select } = await import("@inquirer/prompts");
    return select({
      message,
      choices: [
        { value: "gemini", name: "Google Gemini" },
        { value: "openrouter", name: "OpenRouter (free models available)" },
      ],
    });
  },
  enterSecret: async (message: string): Promise<string> => {
    const { password } = await import("@inquirer/prompts");
    return password({ message, mask: "*" });
  },
  chooseModel: async (models: readonly ModelOption[]): Promise<string> => {
    const { select } = await import("@inquirer/prompts");
    return select({
      message: "Choose a model:",
      choices: models.map((model): { value: string; name: string } => ({
        value: model.id,
        name: model.label,
      })),
    });
  },
  enterText: async (message: string): Promise<string> => {
    const { input } = await import("@inquirer/prompts");
    return input({ message });
  },
};

export function isPromptCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}
