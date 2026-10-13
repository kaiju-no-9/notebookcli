import { describe, expect, it } from "bun:test";
import { SlashCommandRouter } from "../SlashCommandRouter.js";
import { HelpCommand } from "./HelpCommand.js";

describe("HelpCommand", (): void => {
  it("lists every registered command", async (): Promise<void> => {
    const router = new SlashCommandRouter();
    router.register({ name: "help", description: "Show help", execute: async () => ({ output: "", restart: false }) });
    router.register({ name: "web", description: "Configure search", execute: async () => ({ output: "", restart: false }) });
    router.register({ name: "sessions", description: "Manage sessions", execute: async () => ({ output: "", restart: false }) });
    const command = new HelpCommand(() => router.getCommandList());
    const output = (await command.execute()).output;
    expect(output).toContain("/help");
    expect(output).toContain("/web");
    expect(output).toContain("/sessions");
    expect(output).toContain("exit / quit");
  });
});
