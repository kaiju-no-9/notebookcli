import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { Message, Part } from "../agent/Message.js";
import { SecretScanner } from "../guardrails/types/SecretScanner.js";

export interface CodingSession {
  readonly id: string;
  readonly title: string;
  readonly projectDirectory: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: Message[];
}

const textPartSchema = z.object({ text: z.string() });
const functionCallPartSchema = z.object({
  functionCall: z.object({
    id: z.string().optional(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
    thoughtSignature: z.string().optional(),
  }),
});
const functionResponsePartSchema = z.object({
  functionResponse: z.object({ toolCallId: z.string().optional(), name: z.string(), response: z.string() }),
});
const messageSchema = z.object({
  role: z.enum(["user", "model", "tool"]),
  parts: z.array(z.union([textPartSchema, functionCallPartSchema, functionResponsePartSchema])),
  agentName: z.string().optional(),
  runID: z.string().optional(),
});
const sessionSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  projectDirectory: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  history: z.array(messageSchema),
});
const indexSchema = z.object({
  version: z.literal(1),
  activeSessionId: z.string().uuid(),
  sessionIds: z.array(z.string().uuid()),
});

interface SessionIndex {
  readonly version: 1;
  readonly activeSessionId: string;
  readonly sessionIds: string[];
}

function redactPart(part: Part): Part {
  if ("text" in part) {
    return { text: SecretScanner.redact(part.text) };
  }
  if ("functionCall" in part) {
    return {
      functionCall: {
        ...part.functionCall,
        args: Object.fromEntries(Object.entries(part.functionCall.args).map(([key, value]): [string, unknown] =>
          [key, redactValue(value)],
        )),
      },
    };
  }
  return { functionResponse: { ...part.functionResponse, response: SecretScanner.redact(part.functionResponse.response) } };
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return SecretScanner.redact(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]): [string, unknown] => [key, redactValue(item)]));
  }
  return value;
}

function persistedHistory(history: readonly Message[]): Message[] {
  return history.map((message): Message => ({ ...message, parts: message.parts.map(redactPart) }));
}

function titleFromHistory(history: readonly Message[], currentTitle: string): string {
  if (currentTitle !== "New session") {
    return currentTitle;
  }
  const firstUserMessage = history.find((message): boolean => message.role === "user")?.parts
    .find((part): part is { text: string } => "text" in part)?.text;
  if (firstUserMessage === undefined || firstUserMessage.trim().length === 0) {
    return currentTitle;
  }
  const title = firstUserMessage.trim().replace(/\s+/g, " ");
  return title.length > 64 ? `${title.slice(0, 61)}...` : title;
}

export class SessionStore {
  public readonly projectDirectory: string;
  private readonly projectSessionsDirectory: string;
  private readonly indexPath: string;

  public constructor(projectDirectory: string = process.cwd(), homeDirectory: string = process.env.HOME ?? homedir()) {
    this.projectDirectory = resolve(projectDirectory);
    const projectHash = createHash("sha256").update(this.projectDirectory).digest("hex");
    this.projectSessionsDirectory = join(homeDirectory, ".oden", "sessions", projectHash);
    this.indexPath = join(this.projectSessionsDirectory, "index.json");
  }

  public async initialize(): Promise<CodingSession> {
    const index = await this.readIndex();
    if (index !== undefined && index.sessionIds.includes(index.activeSessionId)) {
      try {
        return await this.readSession(index.activeSessionId);
      } catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
        await this.writeIndex({
          version: 1,
          activeSessionId: index.activeSessionId,
          sessionIds: index.sessionIds.filter((id): boolean => id !== index.activeSessionId),
        });
      }
    }
    return this.create("New session");
  }

  public async list(): Promise<CodingSession[]> {
    const index = await this.readIndex();
    if (index === undefined) {
      return [];
    }
    const sessions = await Promise.all(index.sessionIds.map(async (id): Promise<CodingSession | undefined> => {
      try {
        return await this.readSession(id);
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    }));
    return sessions.filter((session): session is CodingSession => session !== undefined)
      .sort((left, right): number => right.updatedAt.localeCompare(left.updatedAt));
  }

  public async getActive(): Promise<CodingSession> {
    const index = await this.readIndex();
    if (index === undefined || !index.sessionIds.includes(index.activeSessionId)) {
      return this.initialize();
    }
    return this.readSession(index.activeSessionId);
  }

  public async create(title = "New session"): Promise<CodingSession> {
    const index = await this.readIndex();
    const now = new Date().toISOString();
    const session: CodingSession = {
      id: randomUUID(),
      title: title.trim().slice(0, 200) || "New session",
      projectDirectory: this.projectDirectory,
      createdAt: now,
      updatedAt: now,
      history: [],
    };
    await this.writeSession(session);
    await this.writeIndex({
      version: 1,
      activeSessionId: session.id,
      sessionIds: [...new Set([...(index?.sessionIds ?? []), session.id])],
    });
    return session;
  }

  public async switchTo(id: string): Promise<CodingSession> {
    const session = await this.readSession(id);
    const index = await this.readIndex();
    const sessionIds = index?.sessionIds ?? [];
    if (!sessionIds.includes(id)) {
      throw new Error("That session is not listed for this project");
    }
    await this.writeIndex({ version: 1, activeSessionId: id, sessionIds });
    return session;
  }

  public async updateActiveHistory(history: readonly Message[]): Promise<CodingSession> {
    const current = await this.getActive();
    const safeHistory = persistedHistory(history);
    const updated: CodingSession = {
      ...current,
      title: titleFromHistory(safeHistory, current.title),
      updatedAt: new Date().toISOString(),
      history: safeHistory,
    };
    await this.writeSession(updated);
    return updated;
  }

  public async delete(id: string): Promise<{ readonly deletedId: string; readonly activeSession: CodingSession }> {
    const index = await this.readIndex();
    if (index === undefined || !index.sessionIds.includes(id)) {
      throw new Error("That session does not exist for this project");
    }
    const remainingIds = index.sessionIds.filter((sessionId): boolean => sessionId !== id);
    let remaining = await Promise.all(remainingIds.map((sessionId): Promise<CodingSession> => this.readSession(sessionId)));
    remaining.sort((left, right): number => right.updatedAt.localeCompare(left.updatedAt));
    const wasActive = index.activeSessionId === id;
    let activeSession = wasActive ? remaining[0] : await this.readSession(index.activeSessionId);
    await rm(this.sessionPath(id), { force: true });
    if (activeSession === undefined) {
      const now = new Date().toISOString();
      activeSession = {
        id: randomUUID(),
        title: "New session",
        projectDirectory: this.projectDirectory,
        createdAt: now,
        updatedAt: now,
        history: [],
      };
      await this.writeSession(activeSession);
      await this.writeIndex({ version: 1, activeSessionId: activeSession.id, sessionIds: [activeSession.id] });
    } else {
      await this.writeIndex({ version: 1, activeSessionId: activeSession.id, sessionIds: remainingIds });
    }
    return { deletedId: id, activeSession };
  }

  private sessionPath(id: string): string {
    const parsedId = z.string().uuid().parse(id);
    return join(this.projectSessionsDirectory, `${parsedId}.json`);
  }

  private async readSession(id: string): Promise<CodingSession> {
    const raw: unknown = JSON.parse(await readFile(this.sessionPath(id), "utf8"));
    const parsed = sessionSchema.parse(raw);
    if (parsed.projectDirectory !== this.projectDirectory || parsed.id !== id) {
      throw new Error("Session record does not match the current project or session ID");
    }
    return {
      id: parsed.id,
      title: parsed.title,
      projectDirectory: parsed.projectDirectory,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      history: parsed.history,
    };
  }

  private async readIndex(): Promise<SessionIndex | undefined> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.indexPath, "utf8"));
      return indexSchema.parse(raw);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw new Error(`Could not read session index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async writeSession(session: CodingSession): Promise<void> {
    const path = this.sessionPath(session.id);
    await this.atomicWrite(path, JSON.stringify({ version: 1, ...session }));
  }

  private async writeIndex(index: SessionIndex): Promise<void> {
    await this.atomicWrite(this.indexPath, JSON.stringify(index));
  }

  private async atomicWrite(path: string, contents: string): Promise<void> {
    const odenDirectory = join(this.projectSessionsDirectory, "..", "..");
    const sessionsDirectory = join(this.projectSessionsDirectory, "..");
    await mkdir(this.projectSessionsDirectory, { recursive: true, mode: 0o700 });
    await chmod(odenDirectory, 0o700);
    await chmod(sessionsDirectory, 0o700);
    await chmod(this.projectSessionsDirectory, 0o700);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
