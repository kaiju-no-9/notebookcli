import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Message } from "../agent/Message.js";
import { SessionStore } from "./SessionStore.js";

describe("SessionStore", (): void => {
  let temporaryHome: string;
  let projectDirectory: string;

  beforeEach(async (): Promise<void> => {
    temporaryHome = await mkdtemp(join(tmpdir(), "oden-sessions-test-"));
    projectDirectory = join(temporaryHome, "project-a");
  });

  afterEach(async (): Promise<void> => {
    await rm(temporaryHome, { recursive: true, force: true });
  });

  it("creates UUID sessions and resumes the active session with saved history", async (): Promise<void> => {
    const store = new SessionStore(projectDirectory, temporaryHome);
    const created = await store.initialize();
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const history: Message[] = [
      { role: "user", parts: [{ text: "Build the garden planner" }] },
      { role: "model", parts: [{ text: "I will inspect the project." }] },
    ];
    await store.updateActiveHistory(history);

    const resumed = await new SessionStore(projectDirectory, temporaryHome).initialize();
    expect(resumed.id).toBe(created.id);
    expect(resumed.title).toBe("Build the garden planner");
    expect(resumed.history).toEqual(history);
  });

  it("keeps sessions scoped to the resolved project directory", async (): Promise<void> => {
    const first = new SessionStore(projectDirectory, temporaryHome);
    const second = new SessionStore(join(temporaryHome, "project-b"), temporaryHome);
    const sessionA = await first.initialize();
    const sessionB = await second.initialize();
    expect(sessionA.id).not.toBe(sessionB.id);
    expect(await first.list()).toHaveLength(1);
    expect(await second.list()).toHaveLength(1);
  });

  it("switches sessions and restores the selected history", async (): Promise<void> => {
    const store = new SessionStore(projectDirectory, temporaryHome);
    const first = await store.initialize();
    await store.updateActiveHistory([{ role: "user", parts: [{ text: "Task one" }] }]);
    const second = await store.create("Task two");
    await store.updateActiveHistory([{ role: "user", parts: [{ text: "Task two details" }] }]);

    const switched = await store.switchTo(first.id);

    expect(switched.id).toBe(first.id);
    expect(switched.history[0]?.parts[0]).toEqual({ text: "Task one" });
    expect((await store.getActive()).id).toBe(first.id);
    expect((await store.list()).map((session): string => session.id)).toContain(second.id);
  });

  it("deletes an inactive session without changing the current session", async (): Promise<void> => {
    const store = new SessionStore(projectDirectory, temporaryHome);
    const first = await store.initialize();
    const second = await store.create("Keep me");
    const result = await store.delete(first.id);

    expect(result.deletedId).toBe(first.id);
    expect(result.activeSession.id).toBe(second.id);
    expect((await store.list()).map((session): string => session.id)).toEqual([second.id]);
  });

  it("deletes the active session and activates the most recently updated remaining session", async (): Promise<void> => {
    const store = new SessionStore(projectDirectory, temporaryHome);
    const first = await store.initialize();
    await store.updateActiveHistory([{ role: "user", parts: [{ text: "Older task" }] }]);
    const second = await store.create("Newer task");

    const result = await store.delete(second.id);

    expect(result.deletedId).toBe(second.id);
    expect(result.activeSession.id).toBe(first.id);
    expect(result.activeSession.history).toHaveLength(1);
    expect((await store.getActive()).id).toBe(first.id);
  });

  it("removes the last session and replaces it with a new empty UUID session", async (): Promise<void> => {
    const store = new SessionStore(projectDirectory, temporaryHome);
    const session = await store.initialize();
    await store.updateActiveHistory([{ role: "user", parts: [{ text: "Private old task" }] }]);

    const result = await store.delete(session.id);

    expect(result.activeSession.id).not.toBe(session.id);
    expect(result.activeSession.history).toEqual([]);
    expect(await store.list()).toHaveLength(1);
    const deletedPath = join(temporaryHome, ".oden", "sessions", createHashForProject(projectDirectory), `${session.id}.json`);
    await expect(readFile(deletedPath)).rejects.toThrow();
  });

  it("redacts secrets before writing history and uses private file permissions", async (): Promise<void> => {
    const store = new SessionStore(projectDirectory, temporaryHome);
    const session = await store.initialize();
    const secret = `AIza${"A".repeat(35)}`;
    await store.updateActiveHistory([{ role: "user", parts: [{ text: `key ${secret}` }] }]);
    const sessions = await store.list();
    const recordPath = join(temporaryHome, ".oden", "sessions", createHashForProject(projectDirectory), `${session.id}.json`);
    const contents = await readFile(recordPath, "utf8");
    const directoryMode = (await stat(join(temporaryHome, ".oden", "sessions", createHashForProject(projectDirectory)))).mode & 0o777;

    expect(sessions[0]?.history[0]?.parts[0]).toEqual({ text: "key [REDACTED]" });
    expect(contents).not.toContain(secret);
    expect((await stat(recordPath)).mode & 0o777).toBe(0o600);
    expect(directoryMode).toBe(0o700);
  });

  it("rejects malformed session indexes without overwriting them", async (): Promise<void> => {
    const store = new SessionStore(projectDirectory, temporaryHome);
    await store.initialize();
    const indexPath = join(temporaryHome, ".oden", "sessions", createHashForProject(projectDirectory), "index.json");
    await Bun.write(indexPath, "invalid");

    await expect(store.list()).rejects.toThrow("Could not read session index");
    expect(await Bun.file(indexPath).text()).toBe("invalid");
  });
});

function createHashForProject(projectDirectory: string): string {
  return createHash("sha256").update(resolve(projectDirectory)).digest("hex");
}
