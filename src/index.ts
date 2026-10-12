#!/usr/bin/env bun

import { Command, Option } from "commander";
import { Agent } from "./agent/Agent.js";
import { ResearchAgent } from "./agent/ResearchAgent.js";
import { AgentCLI } from "./cli/AgentCLI.js";
import { AgentUI } from "./cli/AgentUI.js";
import { TerminalState } from "./cli/TerminalState.js";
import { ConfigManager } from "./config/ConfigManager.js";
import type { ProviderType } from "./config/ModelCatalog.js";
import { InputGuardrails } from "./guardrails/input/InputGuardrails.js";
import { OutputGuardrails } from "./guardrails/output/OutputGuardrails.js";
import { Orchestrator } from "./orchestration/Orchestrator.js";
import { Supervisor } from "./orchestration/Supervisor.js";
import { GeminiConfig } from "./providers/GeminiConfig.js";
import { GeminiProvider } from "./providers/GeminiProvider.js";
import { GeminiStreaming } from "./providers/GeminiStreaming.js";
import { OpenRouterConfig } from "./providers/OpenRouterConfig.js";
import { OpenRouterProvider } from "./providers/OpenRouterProvider.js";
import { SlashCommandRouter } from "./cli/SlashCommandRouter.js";
import { HelpCommand } from "./cli/commands/HelpCommand.js";
import { DeleteCommand } from "./cli/commands/DeleteCommand.js";
import { MemoryCommand } from "./cli/commands/MemoryCommand.js";
import { ProviderCommand, type ProviderCommandConfig } from "./cli/commands/ProviderCommand.js";
import { StatusCommand } from "./cli/commands/StatusCommand.js";
import { WebCommand } from "./cli/commands/WebCommand.js";
import { SessionCommand } from "./cli/commands/SessionCommand.js";
import { SessionStore, type CodingSession } from "./sessions/SessionStore.js";
import type { Message } from "./agent/Message.js";
import { ToolRegistry } from "./tools/ToolRegistry.js";
import { registerCodingTools } from "./tools/CodingTools.js";
import { registerFileTools } from "./tools/FileTools.js";
import { registerExecuteTools } from "./tools/executeTools.js";
import { registerGitTools } from "./tools/GitTools.js";
import { registerMemoryTools } from "./tools/MemoryTools.js";
import { registerSearchTools } from "./tools/SearchTool.js";
import { ErrorTranslator } from "./utils/ErrorTranslator.js";

export interface ApplicationOptions {
  readonly provider?: ProviderType;
  readonly model?: string;
}

export interface ResolvedApplicationConfig extends ApplicationOptions {
  readonly apiKey?: string;
  readonly providerConfigured: boolean;
}

export interface ApplicationConfigStore {
  has(key: string): Promise<boolean>;
  get(key: string): Promise<string>;
  getStored(key: string): Promise<string | undefined>;
}

export interface ApplicationSessionRuntime {
  readonly store: SessionStore;
  activeSession: CodingSession;
}

function providerDefaults(provider: "openrouter" | "gemini"): { model: string; guardModel: string } {
  return provider === "gemini"
    ? { model: GeminiConfig.PRIMARY_MODEL, guardModel: GeminiConfig.GUARD_MODEL }
    : { model: OpenRouterConfig.DEFAULT_MODEL, guardModel: OpenRouterConfig.GUARD_MODEL };
}

export function createProgram(): Command {
  return new Command()
    .name("oden")
    .description("Autonomous terminal coding and research agent")
    .addOption(new Option("--provider <provider>", "LLM provider to use (openrouter or gemini)")
      .choices(["openrouter", "gemini"]))
    .option("--model <model>", "Override the selected provider's default model")
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

export async function resolveApplicationConfig(
  options: ApplicationOptions = {},
  store: ApplicationConfigStore = ConfigManager,
): Promise<ResolvedApplicationConfig> {
  const storedProvider = await store.getStored("ODEN_PROVIDER");
  const configuredProvider = storedProvider ?? (await store.has("ODEN_PROVIDER") ? await store.get("ODEN_PROVIDER") : undefined);
  const providerValue = options.provider ?? configuredProvider;
  let provider: ProviderType | undefined;
  if (providerValue !== undefined) {
    if (providerValue !== "gemini" && providerValue !== "openrouter") {
      throw new Error(`Invalid configured provider '${providerValue}'. Use 'gemini' or 'openrouter'.`);
    }
    provider = providerValue;
  } else {
    // Existing API-key-only setups continue to work; OpenRouter remains the default when both keys exist.
    if (await store.has("OPENROUTER_API_KEY")) {
      provider = "openrouter";
    } else if (await store.has("GEMINI_API_KEY")) {
      provider = "gemini";
    }
  }

  const storedModel = await store.getStored("ODEN_MODEL");
  const configuredModel = storedModel ?? (await store.has("ODEN_MODEL") ? await store.get("ODEN_MODEL") : undefined);
  const providerChanged = options.provider !== undefined && configuredProvider !== undefined && options.provider !== configuredProvider;
  const model = options.model ?? (providerChanged ? undefined : configuredModel) ?? (provider === undefined ? undefined : providerDefaults(provider).model);
  const keyName = provider === "gemini" ? "GEMINI_API_KEY" : provider === "openrouter" ? "OPENROUTER_API_KEY" : undefined;
  const apiKey = keyName !== undefined && await store.has(keyName) ? await store.get(keyName) : undefined;
  return { provider, model, apiKey, providerConfigured: provider !== undefined && apiKey !== undefined && apiKey.length > 0 };
}

function createSlashCommandRouter(
  config: ProviderCommandConfig,
  sessionRuntime: ApplicationSessionRuntime | undefined,
  getHistory: () => Message[],
  activateSession: (session: CodingSession) => void,
): SlashCommandRouter {
  const router = new SlashCommandRouter();
  router.register(new ProviderCommand(config));
  router.register(new WebCommand());
  router.register(new MemoryCommand());
  router.register(new DeleteCommand());
  if (sessionRuntime !== undefined) {
    router.register(new SessionCommand(sessionRuntime.store, activateSession, undefined, getHistory));
  }
  router.register(new StatusCommand(config));
  router.register(new HelpCommand((): Array<{ name: string; description: string }> => router.getCommandList()));
  return router;
}

export function createApplication(
  apiKey: string | undefined,
  options: ResolvedApplicationConfig,
  sessionRuntime?: ApplicationSessionRuntime,
): AgentCLI {
  const providerType = options.provider;
  const defaults = providerType === undefined ? undefined : providerDefaults(providerType);
  const model = options.model ?? (providerType === undefined ? undefined : defaults?.model);
  const logger = {
    warn: (message: string, meta?: Record<string, unknown>): void => {
      void import("./logger/AgentLogger.js")
        .then(({ AgentLogger }): void => AgentLogger.warn(message, meta))
        .catch((): void => undefined);
    },
  };
  const terminalState = new TerminalState();
  let orchestrator: Pick<Orchestrator, "process"> & Partial<Pick<Orchestrator, "getHistory" | "setHistory">>;
  if (!options.providerConfigured || providerType === undefined || apiKey === undefined || defaults === undefined || model === undefined) {
    orchestrator = { process: async (): Promise<string> => "No provider configured. Run /provider to set up your LLM provider." };
  } else {
    const provider = providerType === "gemini"
      ? new GeminiProvider(undefined, model, apiKey)
      : new OpenRouterProvider(apiKey, model);
    const streaming = providerType === "gemini"
      ? new GeminiStreaming(apiKey, undefined, model)
      : provider as OpenRouterProvider;
    const registry = createToolRegistry();
    const callbacks = { onStatus: (status: string): void => terminalState.updateSpinner(status) };
    const agent = new Agent(provider, registry, callbacks);
    const searchTool = registry.get("search");
    if (searchTool === undefined) {
      throw new Error("Search tool registration failed");
    }
    const researchAgent = new ResearchAgent(provider, searchTool);
    const saveMemoryTool = registry.get("save_memory");
    const searchMemoryTool = registry.get("search_memory");
    if (saveMemoryTool === undefined || searchMemoryTool === undefined) {
      throw new Error("Memory tool registration failed");
    }
    const directMemoryTools = {
      save: (key: string, value: string): Promise<string> => saveMemoryTool.execute({ key, value }),
      search: (query: string): Promise<string> => searchMemoryTool.execute({ query }),
    };
    const inputGuardrails = new InputGuardrails(provider, undefined, logger, defaults.guardModel);
    const outputGuardrails = new OutputGuardrails(provider, logger, defaults.guardModel);
    const supervisor = new Supervisor(provider, logger, defaults.guardModel);
    orchestrator = new Orchestrator(
      provider,
      streaming,
      agent,
      researchAgent,
      inputGuardrails,
      outputGuardrails,
      supervisor,
      callbacks,
      directMemoryTools,
      sessionRuntime?.activeSession.history ?? [],
      sessionRuntime === undefined
        ? undefined
        : async (history: readonly Message[]): Promise<void> => {
          sessionRuntime.activeSession = await sessionRuntime.store.updateActiveHistory(history);
        },
    );
  }
  const config = {
    provider: providerType,
    model,
    providerConfigured: options.providerConfigured,
    ...(sessionRuntime === undefined ? {} : { sessionTitle: (): string => sessionRuntime.activeSession.title }),
  };
  const getHistory = (): Message[] => orchestrator.getHistory?.() ?? sessionRuntime?.activeSession.history ?? [];
  const activateSession = (session: CodingSession): void => {
    if (sessionRuntime !== undefined) {
      sessionRuntime.activeSession = session;
    }
    orchestrator.setHistory?.(session.history);
  };
  return new AgentCLI(
    orchestrator,
    new AgentUI(),
    terminalState,
    undefined,
    createSlashCommandRouter(config, sessionRuntime, getHistory, activateSession),
    config,
  );
}

export async function startApplication(options: ApplicationOptions = {}): Promise<void> {
  let startupOptions = options;
  const sessionStore = new SessionStore(process.cwd());
  const sessionRuntime: ApplicationSessionRuntime = {
    store: sessionStore,
    activeSession: await sessionStore.initialize(),
  };
  while (true) {
    const config = await resolveApplicationConfig(startupOptions);
    const app = createApplication(config.apiKey, config, sessionRuntime);
    if (await app.start() !== "restart") {
      return;
    }
    // A slash-command selection is persisted and takes effect on the rebuilt pipeline.
    startupOptions = {};
  }
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
  const options = program.opts<{ provider?: ProviderType; model?: string }>();
  try {
    await startApplication(options);
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
