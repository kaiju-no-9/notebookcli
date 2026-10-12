import type { SlashCommandHandler, SlashCommandResult } from "../SlashCommandRouter.js";

export interface ListedSlashCommand {
  readonly name: string;
  readonly description: string;
}

export class HelpCommand implements SlashCommandHandler {
  public readonly name = "help";
  public readonly description = "Show this help message";

  public constructor(private readonly commands: () => readonly ListedSlashCommand[]) {}

  public async execute(): Promise<SlashCommandResult> {
    const lines = ["Available commands:"];
    for (const command of this.commands()) {
      lines.push(`  /${command.name.padEnd(9)} — ${command.description}`);
    }
    lines.push("  exit / quit — Exit Oden");
    return { output: lines.join("\n"), restart: false };
  }
}
