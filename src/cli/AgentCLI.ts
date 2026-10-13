import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { ProviderType } from "../config/ModelCatalog.js";
import { AgentUI } from "./AgentUI.js";
import { SlashCommandRouter } from "./SlashCommandRouter.js";
import { TerminalState } from "./TerminalState.js";

export interface PromptReader {
  question(prompt: string): Promise<string>;
  close(): void;
}

export interface ProcessOrchestrator {
  process(input: string): Promise<string>;
  cancelActiveRun?(): void;
}

export interface CLIConfig {
  readonly provider?: ProviderType;
  readonly model?: string;
  readonly providerConfigured: boolean;
  readonly sessionTitle?: () => string;
}

function defaultReader(): PromptReader {
  const reader: ReadlineInterface = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  let rejectPending: ((error: Error) => void) | undefined;
  reader.once("close", (): void => { rejectPending?.(new Error("Input closed")); });
  return {
    question: async (prompt: string): Promise<string> => new Promise((resolve, reject): void => {
      rejectPending = reject;
      reader.question(prompt, (answer: string): void => {
        rejectPending = undefined;
        resolve(answer);
      });
    }),
    close: (): void => { reader.close(); },
  };
}

export class AgentCLI {
  private streamedText = "";

  public constructor(
    private readonly orchestrator: ProcessOrchestrator,
    private readonly ui: AgentUI = new AgentUI(),
    private readonly terminalState: TerminalState = new TerminalState(),
    private readonly reader?: PromptReader,
    private readonly slashCommands?: SlashCommandRouter,
    private readonly config: CLIConfig = { provider: "openrouter", model: "openrouter/free", providerConfigured: true },
    private readonly readerFactory?: () => PromptReader,
  ) {}

  public renderToken(token: string): void {
    this.streamedText += token;
    this.ui.renderToken(token);
  }

  public renderStatus(status: string): void {
    if (/^(?:Acting step|Planning\.\.\.)/i.test(status)) return;
    this.ui.renderStatus(status);
  }

  public async start(): Promise<"exit" | "restart"> {
    this.ui.render("Oden is ready. Enter 'exit' or 'quit' to leave.");
    const createReader = this.readerFactory ?? (this.reader === undefined ? defaultReader : (): PromptReader => this.reader as PromptReader);
    const canReopenReader = this.reader === undefined || this.readerFactory !== undefined;
    let reader = createReader();
    let interrupted = false;
    let restartRequested = false;
    const onInterrupt = (): void => {
      interrupted = true;
      this.orchestrator.cancelActiveRun?.();
      reader.close();
    };
    process.on("SIGINT", onInterrupt);
    try {
      while (!interrupted) {
        let input: string;
        try {
          const model = this.config.model ?? "unknown model";
          const displayModel = this.config.provider === "openrouter" && model.startsWith("openrouter/")
            ? model.slice("openrouter/".length)
            : model;
          const prompt = this.config.providerConfigured && this.config.provider !== undefined
            ? `oden [${this.config.provider}/${displayModel}${this.sessionPromptLabel()}]> `
            : `oden [no provider${this.sessionPromptLabel()}]> `;
          input = await reader.question(prompt);
        } catch {
          break;
        }
        const normalized = input.trim().toLowerCase();
        if (normalized === "exit" || normalized === "quit") {
          break;
        }
        if (input.trim().length === 0) {
          continue;
        }
        if (this.slashCommands?.isSlashCommand(input) === true) {
          const commandName = input.trim().split(/\s+/, 1)[0]?.slice(1).toLowerCase() ?? "";
          if (!this.config.providerConfigured && !["provider", "status", "help", "sessions"].includes(commandName)) {
            this.ui.render("No provider configured. Run /provider to set up your LLM provider.");
            continue;
          }
          if (canReopenReader) {
            reader.close();
          }
          try {
            const result = await this.slashCommands.dispatch(input);
            this.ui.render(result.output);
            if (result.restart) {
              restartRequested = true;
              break;
            }
          } catch (error: unknown) {
            this.ui.render(`Command failed: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            if (canReopenReader && !restartRequested && !interrupted) {
              reader = createReader();
            }
          }
          continue;
        }
        if (!this.config.providerConfigured) {
          this.ui.render("No provider configured. Run /provider to set up your LLM provider.");
          continue;
        }
        if (canReopenReader) reader.close();
        this.terminalState.startSpinner("Working...");
        this.streamedText = "";
        this.ui.renderStatus("Working on your request...");
        try {
          const response = await this.orchestrator.process(input);
          if (this.streamedText.length > 0) {
            this.ui.finishStream();
            if (this.streamedText !== response) this.ui.render(response);
          } else {
            this.ui.render(response);
          }
        } catch (error: unknown) {
          this.ui.render(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          this.terminalState.stopSpinner();
          if (canReopenReader && !interrupted) reader = createReader();
        }
      }
    } finally {
      process.off("SIGINT", onInterrupt);
      this.terminalState.stopSpinner();
      reader.close();
    }
    if (restartRequested) {
      this.ui.render("Restarting Oden with the saved provider configuration...");
      return "restart";
    }
    this.ui.render("Goodbye.");
    return "exit";
  }

  private sessionPromptLabel(): string {
    const title = this.config.sessionTitle?.().trim();
    return title === undefined || title.length === 0 ? "" : ` | ${title}`;
  }
}
