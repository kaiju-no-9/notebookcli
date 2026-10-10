import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { Orchestrator } from "../orchestration/Orchestrator.js";
import { AgentUI } from "./AgentUI.js";
import { TerminalState } from "./TerminalState.js";

export interface PromptReader {
  question(prompt: string): Promise<string>;
  close(): void;
}

export interface ProcessOrchestrator {
  process(input: string): Promise<string>;
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
  public constructor(
    private readonly orchestrator: Pick<Orchestrator, "process"> | ProcessOrchestrator,
    private readonly ui: AgentUI = new AgentUI(),
    private readonly terminalState: TerminalState = new TerminalState(),
    private readonly reader?: PromptReader,
  ) {}

  public async start(): Promise<void> {
    this.ui.render("Oden is ready. Enter 'exit' or 'quit' to leave.");
    const reader = this.reader ?? defaultReader();
    let interrupted = false;
    const onInterrupt = (): void => {
      interrupted = true;
      reader.close();
    };
    process.on("SIGINT", onInterrupt);
    try {
      while (!interrupted) {
        let input: string;
        try {
          input = await reader.question("oden> ");
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
        this.terminalState.startSpinner("Working...");
        try {
          const response = await this.orchestrator.process(input);
          this.ui.render(response);
        } catch (error: unknown) {
          this.ui.render(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          this.terminalState.stopSpinner();
        }
      }
    } finally {
      process.off("SIGINT", onInterrupt);
      this.terminalState.stopSpinner();
      reader.close();
    }
    this.ui.render("Goodbye.");
  }
}
