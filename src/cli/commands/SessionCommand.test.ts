import { describe, expect, it } from "bun:test";
import type { Message } from "../../agent/Message.js";
import type { CodingSession } from "../../sessions/SessionStore.js";
import { SessionCommand, type SessionAction, type SessionCommandPrompts, type SessionCommandStore } from "./SessionCommand.js";

function session(id: string, title: string, text = ""): CodingSession {
  const now = new Date().toISOString();
  const history: Message[] = text.length === 0 ? [] : [{ role: "user", parts: [{ text }] }];
  return { id, title, projectDirectory: "/project", createdAt: now, updatedAt: now, history };
}

class FakeSessionStore implements SessionCommandStore {
  public sessions: CodingSession[] = [session("session-a", "Alpha"), session("session-b", "Beta")];
  public active = this.sessions[0] as CodingSession;
  public readonly deleted: string[] = [];
  public readonly flushed: Message[][] = [];

  public async list(): Promise<CodingSession[]> { return this.sessions; }
  public async getActive(): Promise<CodingSession> { return this.active; }
  public async updateActiveHistory(history: readonly Message[]): Promise<CodingSession> {
    this.flushed.push([...history]);
    return this.active;
  }
  public async create(title: string): Promise<CodingSession> {
    this.active = session("session-new", title);
    this.sessions = [...this.sessions, this.active];
    return this.active;
  }
  public async switchTo(id: string): Promise<CodingSession> {
    const next = this.sessions.find((item): boolean => item.id === id);
    if (next === undefined) throw new Error("missing session");
    this.active = next;
    return next;
  }
  public async delete(id: string): Promise<{ readonly deletedId: string; readonly activeSession: CodingSession }> {
    this.deleted.push(id);
    this.sessions = this.sessions.filter((item): boolean => item.id !== id);
    if (this.active.id === id) this.active = this.sessions[0] ?? session("session-fresh", "New session");
    return { deletedId: id, activeSession: this.active };
  }
}

function prompts(action: SessionAction, selectedId = "session-b", confirm = true): SessionCommandPrompts {
  return {
    chooseAction: async (): Promise<SessionAction> => action,
    enterTitle: async (): Promise<string> => "Gamma",
    chooseSession: async (): Promise<string> => selectedId,
    confirmDelete: async (): Promise<boolean> => confirm,
  };
}

describe("SessionCommand", (): void => {
  it("creates a titled session and flushes the current history first", async (): Promise<void> => {
    const store = new FakeSessionStore();
    const active: CodingSession[] = [];
    const command = new SessionCommand(store, (next): void => { active.push(next); }, prompts("create"), (): Message[] => [
      { role: "user", parts: [{ text: "Existing work" }] },
    ]);

    const result = await command.execute();

    expect(result.output).toContain("Started session 'Gamma'");
    expect(store.flushed).toHaveLength(1);
    expect(active[0]?.id).toBe("session-new");
  });

  it("switches sessions and activates the selected conversation", async (): Promise<void> => {
    const store = new FakeSessionStore();
    let activated: CodingSession | undefined;
    const command = new SessionCommand(store, (next): void => { activated = next; }, prompts("switch"));

    const result = await command.execute();

    expect(result.output).toContain("Switched to 'Beta'");
    expect(activated?.id).toBe("session-b");
    expect(store.flushed).toHaveLength(1);
  });

  it("requires confirmation before deletion", async (): Promise<void> => {
    const store = new FakeSessionStore();
    const command = new SessionCommand(store, (): void => undefined, prompts("delete", "session-b", false));

    const result = await command.execute();

    expect(result.output).toContain("No session was deleted");
    expect(store.deleted).toEqual([]);
  });

  it("deletes the selected session and activates the replacement", async (): Promise<void> => {
    const store = new FakeSessionStore();
    let activated: CodingSession | undefined;
    const command = new SessionCommand(store, (next): void => { activated = next; }, prompts("delete"));

    const result = await command.execute();

    expect(result.output).toContain("Deleted session 'Beta'");
    expect(store.deleted).toEqual(["session-b"]);
    expect(activated?.id).toBe("session-a");
  });

  it("lets the user cancel without changing any session", async (): Promise<void> => {
    const store = new FakeSessionStore();
    const command = new SessionCommand(store, (): void => undefined, prompts("cancel"));

    const result = await command.execute();

    expect(result.output).toContain("cancelled");
    expect(store.deleted).toEqual([]);
  });
});
