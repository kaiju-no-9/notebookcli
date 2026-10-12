import { describe, expect, it } from "bun:test";
import { DeleteCommand, type DeleteCommandPrompts, type DeleteCommandStore } from "./DeleteCommand.js";

function storeWith(keys: readonly string[]): DeleteCommandStore & { readonly deleted: string[] } {
  const deleted: string[] = [];
  const available = new Set(keys);
  return {
    deleted,
    getStored: async (key: string): Promise<string | undefined> => available.has(key) ? "secret" : undefined,
    delete: async (key: string): Promise<void> => { deleted.push(key); },
  };
}

describe("DeleteCommand", (): void => {
  it("lists only stored supported API keys and deletes the selected key", async (): Promise<void> => {
    const store = storeWith(["GEMINI_API_KEY", "TAVILY_API_KEY"]);
    let listedKeys: string[] = [];
    const prompts: DeleteCommandPrompts = {
      chooseCredential: async (options): Promise<string> => {
        listedKeys = options.map((option): string => option.key);
        return "TAVILY_API_KEY";
      },
    };

    const result = await new DeleteCommand(store, prompts).execute();

    expect(listedKeys).toEqual(["GEMINI_API_KEY", "TAVILY_API_KEY"]);
    expect(store.deleted).toEqual(["TAVILY_API_KEY"]);
    expect(result.output).toContain("Tavily API key deleted");
    expect(result.output).toContain("/web");
    expect(result.restart).toBe(false);
  });

  it("restarts Oden after deleting an LLM provider key", async (): Promise<void> => {
    const store = storeWith(["GEMINI_API_KEY"]);
    const prompts: DeleteCommandPrompts = { chooseCredential: async (): Promise<string> => "GEMINI_API_KEY" };

    const result = await new DeleteCommand(store, prompts).execute();

    expect(store.deleted).toEqual(["GEMINI_API_KEY"]);
    expect(result.restart).toBe(true);
  });

  it("removes Supermemory's URL setting with its API key", async (): Promise<void> => {
    const store = storeWith(["SUPERMEMORY_API_KEY"]);
    const prompts: DeleteCommandPrompts = { chooseCredential: async (): Promise<string> => "SUPERMEMORY_API_KEY" };

    const result = await new DeleteCommand(store, prompts).execute();

    expect(store.deleted).toEqual(["SUPERMEMORY_API_KEY", "MEMORY_API_URL"]);
    expect(result.output).toContain("/memory");
    expect(result.restart).toBe(false);
  });

  it("does not prompt when no supported API keys are stored", async (): Promise<void> => {
    let promptCalls = 0;
    const prompts: DeleteCommandPrompts = { chooseCredential: async (): Promise<string> => { promptCalls += 1; return ""; } };
    const result = await new DeleteCommand(storeWith([]), prompts).execute();

    expect(promptCalls).toBe(0);
    expect(result.output).toContain("No saved API keys found");
  });

  it("handles a cancelled selection without deleting a key", async (): Promise<void> => {
    const store = storeWith(["OPENROUTER_API_KEY"]);
    const prompts: DeleteCommandPrompts = {
      chooseCredential: async (): Promise<string> => {
        const error = new Error("prompt cancelled");
        error.name = "ExitPromptError";
        throw error;
      },
    };
    const result = await new DeleteCommand(store, prompts).execute();

    expect(result.output).toContain("cancelled");
    expect(store.deleted).toEqual([]);
  });
});
