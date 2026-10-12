import type { Message } from "../../agent/Message.js";
import type { SlashCommandHandler, SlashCommandResult } from "../SlashCommandRouter.js";
import { getInquirerPrompts, isPromptCancelled } from "./SetupPrompts.js";
import type { CodingSession } from "../../sessions/SessionStore.js";

export type SessionAction = "create" | "switch" | "delete" | "cancel";

export interface SessionCommandStore {
  list(): Promise<CodingSession[]>;
  create(title: string): Promise<CodingSession>;
  switchTo(id: string): Promise<CodingSession>;
  delete(id: string): Promise<{ readonly deletedId: string; readonly activeSession: CodingSession }>;
  getActive(): Promise<CodingSession>;
  updateActiveHistory(history: readonly Message[]): Promise<CodingSession>;
}

export interface SessionCommandPrompts {
  chooseAction(): Promise<SessionAction>;
  enterTitle(): Promise<string>;
  chooseSession(sessions: readonly CodingSession[], activeId: string): Promise<string>;
  confirmDelete(title: string): Promise<boolean>;
}

const inquirerSessionPrompts: SessionCommandPrompts = {
  chooseAction: async (): Promise<SessionAction> => {
    const { select } = await getInquirerPrompts();
    return select({
      message: "Manage coding sessions:",
      choices: [
        { value: "create", name: "Create a new session" },
        { value: "switch", name: "Switch session" },
        { value: "delete", name: "Delete session" },
        { value: "cancel", name: "Cancel" },
      ],
    });
  },
  enterTitle: async (): Promise<string> => {
    const { input } = await getInquirerPrompts();
    return input({ message: "Session title (optional):" });
  },
  chooseSession: async (sessions, activeId): Promise<string> => {
    const { select } = await getInquirerPrompts();
    return select({
      message: "Choose a coding session:",
      choices: sessions.map((session): { value: string; name: string } => ({
        value: session.id,
        name: `${session.id.slice(0, 8)}  ${session.title}${session.id === activeId ? "  (active)" : ""}`,
      })),
    });
  },
  confirmDelete: async (title): Promise<boolean> => {
    const { confirm } = await getInquirerPrompts();
    return confirm({ message: `Permanently delete '${title}' and its saved conversation?`, default: false });
  },
};

export type SessionActivation = (session: CodingSession) => void;

export class SessionCommand implements SlashCommandHandler {
  public readonly name = "sessions";
  public readonly description = "Create, switch, or delete project coding sessions";

  public constructor(
    private readonly store: SessionCommandStore,
    private readonly activate: SessionActivation,
    private readonly prompts: SessionCommandPrompts = inquirerSessionPrompts,
    private readonly currentHistory: () => Message[] = (): Message[] => [],
  ) {}

  public async execute(): Promise<SlashCommandResult> {
    try {
      const action = await this.prompts.chooseAction();
      if (action === "cancel") {
        return { output: "Session management cancelled.", restart: false };
      }
      if (action === "create") {
        const title = (await this.prompts.enterTitle()).trim() || "New session";
        await this.store.updateActiveHistory(this.currentHistory());
        const session = await this.store.create(title);
        this.activate(session);
        return { output: `Started session '${session.title}' (${session.id}).`, restart: false };
      }

      const sessions = await this.store.list();
      if (sessions.length === 0) {
        return { output: "No coding sessions are available for this project.", restart: false };
      }
      const active = await this.store.getActive();
      const selectedId = await this.prompts.chooseSession(sessions, active.id);
      const selected = sessions.find((session): boolean => session.id === selectedId);
      if (selected === undefined) {
        return { output: "No session was changed.", restart: false };
      }
      if (action === "switch") {
        await this.store.updateActiveHistory(this.currentHistory());
        const session = await this.store.switchTo(selected.id);
        this.activate(session);
        return { output: `Switched to '${session.title}' (${session.id}).`, restart: false };
      }

      if (!await this.prompts.confirmDelete(selected.title)) {
        return { output: "Session deletion cancelled. No session was deleted.", restart: false };
      }
      const result = await this.store.delete(selected.id);
      this.activate(result.activeSession);
      return {
        output: `Deleted session ${result.deletedId} and its saved conversation. Active session: '${result.activeSession.title}' (${result.activeSession.id}).`,
        restart: false,
      };
    } catch (error: unknown) {
      if (isPromptCancelled(error)) {
        return { output: "Session management cancelled. No session was deleted.", restart: false };
      }
      return { output: `Session command failed: ${error instanceof Error ? error.message : String(error)}`, restart: false };
    }
  }
}
