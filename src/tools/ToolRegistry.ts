import type { ZodType } from "zod";

// Zod v4 exports ZodType; the phase example’s ZodSchema type is not exported.

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: ZodType;
  readonly execute: (args: unknown) => Promise<string>;
}

export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition> = new Map();

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
