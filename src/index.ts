#!/usr/bin/env bun

import { Command } from "commander";
import { Agent } from "./agent/Agent.js";
import { ResearchAgent } from "./agent/ResearchAgent.js";
import { AgentCLI } from "./cli/AgentCLI.js";
import { AgentUI } from "./cli/AgentUI.js";
import { TerminalState } from "./cli/TerminalState.js";
import { ConfigManager } from "./config/ConfigManager.js";
import { InputGuardrails } from "./guardrails/input/InputGuardrails.js";
import { OutputGuardrails } from "./guardrails/output/OutputGuardrails.js";
import { Orchestrator } from "./orchestration/Orchestrator.js";
import { Supervisor } from "./orchestration/Supervisor.js";
import { GeminiConfig } from "./providers/GeminiConfig.js";
import { GeminiProvider } from "./providers/GeminiProvider.js";
import { GeminiStreaming } from "./providers/GeminiStreaming.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";
import { registerCodingTools } from "./tools/CodingTools.js";
import { registerFileTools } from "./tools/FileTools.js";
import { registerExecuteTools } from "./tools/executeTools.js";
import { registerGitTools } from "./tools/GitTools.js";
import { registerMemoryTools } from "./tools/MemoryTools.js";
import { registerSearchTools } from "./tools/SearchTool.js";
import { ErrorTranslator } from "./utils/ErrorTranslator.js";

export interface ApplicationOptions {
  readonly model?: string;
}

export function createProgram(): Command {
  return new Command()
    .name("oden")
    .description("Autonomous terminal coding and research agent")
    .option("--model <model>", "Gemini model for primary agent and direct responses", GeminiConfig.PRIMARY_MODEL)
    .version("1.0.0");
}

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerCodingTools(registry);
  registerFileTools(registry);
  registerExecuteTools(registry);
  registerGitTools(registry);
  registerSearchTools(registry);
  registerMemoryTools(registry);
  return registry;
}

export function createApplication(apiKey: string, options: ApplicationOptions = {}): AgentCLI {
  const model = options.model ?? GeminiConfig.PRIMARY_MODEL;
  const logger = {
    warn: (message: string, meta?: Record<string, unknown>): void => {
      void import("./logger/AgentLogger.js")
        .then(({ AgentLogger }): void => AgentLogger.warn(message, meta))
        .catch((): void => undefined);
    },
  };
  const provider = new GeminiProvider(undefined, model, apiKey);
  const streaming = new GeminiStreaming(apiKey, undefined, model);
  const registry = createToolRegistry();

  const terminalState = new TerminalState();
  const callbacks = { onStatus: (status: string): void => terminalState.updateSpinner(status) };
  const agent = new Agent(provider, registry, callbacks);
  const searchTool = registry.get("search");
  if (searchTool === undefined) {
    throw new Error("Search tool registration failed");
  }
  const researchAgent = new ResearchAgent(provider, searchTool);
  const inputGuardrails = new InputGuardrails(provider, undefined, logger);
  const outputGuardrails = new OutputGuardrails(provider, logger);
  const supervisor = new Supervisor(provider, logger);
  const orchestrator = new Orchestrator(
    provider,
    streaming,
    agent,
    researchAgent,
    inputGuardrails,
    outputGuardrails,
    supervisor,
    callbacks,
  );
  return new AgentCLI(orchestrator, new AgentUI(), terminalState);
}

export async function startApplication(options: ApplicationOptions = {}): Promise<void> {
  const apiKey = await ConfigManager.get("GEMINI_API_KEY");
  const app = createApplication(apiKey, options);
  await app.start();
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
  const options = program.opts<{ model: string }>();
  try {
    await startApplication({ model: options.model });
  } catch (error: unknown) {
    const translated = ErrorTranslator.translate(error);
    try {
      const { AgentLogger } = await import("./logger/AgentLogger.js");
      AgentLogger.error(translated.message, { kind: translated.kind });
    } catch {
      process.stderr.write(`${translated.message} (${translated.kind})\n`);
    }
    process.exitCode = 1;
  }
}

const invokedAsOdenEntry = process.argv[1] === "src/index.ts"
  || process.argv[1]?.endsWith("/src/index.ts") === true
  || process.argv[1]?.endsWith("\\src\\index.ts") === true;

if (import.meta.main && invokedAsOdenEntry) {
  await main();
}
