export interface SlashCommandResult {
  readonly output: string;
  readonly restart: boolean;
}

export interface SlashCommandHandler {
  readonly name: string;
  readonly description: string;
  execute(): Promise<SlashCommandResult>;
}

export class SlashCommandRouter {
  private readonly commands = new Map<string, SlashCommandHandler>();

  public register(handler: SlashCommandHandler): void {
    const name = handler.name.trim().replace(/^\/+/, "").toLowerCase();
    if (name.length === 0) {
      throw new Error("Slash command names cannot be empty");
    }
    if (this.commands.has(name)) {
      throw new Error(`Slash command '/${name}' is already registered`);
    }
    this.commands.set(name, handler);
  }

  public isSlashCommand(input: string): boolean {
    return input.trimStart().startsWith("/");
  }

  public async dispatch(input: string): Promise<SlashCommandResult> {
    const commandName = input.trim().split(/\s+/, 1)[0]?.slice(1).toLowerCase() ?? "";
    const handler = this.commands.get(commandName);
    if (handler === undefined) {
      const available = this.getCommandList().map((command): string => `/${command.name}`).join(", ");
      return {
        output: commandName.length === 0
          ? `Enter a command name. Available commands: ${available}`
          : `Unknown command '/${commandName}'. Available commands: ${available}`,
        restart: false,
      };
    }
    return handler.execute();
  }

  public getCommandList(): Array<{ name: string; description: string }> {
    return [...this.commands.values()].map((command): { name: string; description: string } => ({
      name: command.name,
      description: command.description,
    }));
  }
}
