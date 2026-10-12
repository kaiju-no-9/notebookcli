import type { ModelOption, ProviderType } from "../../config/ModelCatalog.js";

export interface SetupPrompts {
  chooseProvider(message: string): Promise<ProviderType>;
  enterSecret(message: string): Promise<string>;
  chooseModel(models: readonly ModelOption[]): Promise<string>;
  enterText(message: string): Promise<string>;
}

// Begin loading Inquirer while Oden initializes so the first slash command does
// not pay the module graph's cold-start cost.
const inquirerPromptsModule = import("@inquirer/prompts");

export async function getInquirerPrompts(): Promise<typeof import("@inquirer/prompts")> {
  return inquirerPromptsModule;
}

export const inquirerSetupPrompts: SetupPrompts = {
  chooseProvider: async (message: string): Promise<ProviderType> => {
    const { select } = await getInquirerPrompts();
    return select({
      message,
      choices: [
        { value: "gemini", name: "Google Gemini" },
        { value: "openrouter", name: "OpenRouter (free models available)" },
      ],
    });
  },
  enterSecret: async (message: string): Promise<string> => {
    const { password } = await getInquirerPrompts();
    return password({ message, mask: "*" });
  },
  chooseModel: async (models: readonly ModelOption[]): Promise<string> => {
    const { select } = await getInquirerPrompts();
    return select({
      message: "Choose a model:",
      choices: models.map((model): { value: string; name: string } => ({
        value: model.id,
        name: model.label,
      })),
    });
  },
  enterText: async (message: string): Promise<string> => {
    const { input } = await getInquirerPrompts();
    return input({ message });
  },
};

export function isPromptCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}
