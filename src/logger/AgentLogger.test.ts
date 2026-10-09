import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AgentLogger } from "./AgentLogger.js";

describe("AgentLogger", (): void => {
  let captured: string[];
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach((): void => {
    captured = [];
    originalStderrWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stderr.write;
    AgentLogger.setLevel("info");
  });

  afterEach((): void => {
    process.stderr.write = originalStderrWrite;
    AgentLogger.setLevel("info");
  });

  it("writes info messages to stderr with an ISO timestamp", (): void => {
    AgentLogger.info("startup complete");
    expect(captured.join("")).toContain("[INFO] startup complete");
    expect(captured.join("")).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
  });

  it("redacts Google API keys in messages", (): void => {
    AgentLogger.info("key=AIza12345678901234567890123456789012345");
    expect(captured.join("")).toContain("key=[REDACTED]");
    expect(captured.join("")).not.toContain("AIza");
  });

  it("redacts GitHub tokens in messages", (): void => {
    AgentLogger.warn("token ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(captured.join("")).toContain("token [REDACTED]");
    expect(captured.join("")).not.toContain("ghp_");
  });

  it("redacts secrets recursively in metadata", (): void => {
    AgentLogger.info("request", {
      nested: { apiKey: "AIza12345678901234567890123456789012345" },
      tokens: ["ghp_abcdefghijklmnopqrstuvwxyz1234567890"],
    });
    const output = captured.join("");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("AIza");
    expect(output).not.toContain("ghp_");
  });

  it("suppresses info and warn when the level is error", (): void => {
    AgentLogger.setLevel("error");
    AgentLogger.info("hidden info");
    AgentLogger.warn("hidden warning");
    AgentLogger.error("visible error");
    expect(captured.join("")).not.toContain("hidden");
    expect(captured.join("")).toContain("visible error");
  });

  it("enables debug output when the level is set", (): void => {
    AgentLogger.setLevel("debug");
    AgentLogger.debug("debug detail");
    expect(captured.join("")).toContain("[DEBUG] debug detail");
  });

  it("does not throw on malformed metadata or circular values", (): void => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect((): void => AgentLogger.info("circular", circular)).not.toThrow();
    expect(captured.join("")).toContain("[Circular]");
  });
});
