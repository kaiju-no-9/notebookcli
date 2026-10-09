import { describe, expect, it } from "bun:test";
import { ErrorKind, ErrorTranslator } from "./ErrorTranslator.js";

interface ClassificationCase {
  readonly label: string;
  readonly error: unknown;
  readonly expected: ErrorKind;
}

const classificationCases: readonly ClassificationCase[] = [
  { label: "authentication", error: { status: 401, message: "Unauthorized" }, expected: ErrorKind.AUTH_ERROR },
  { label: "rate limit", error: { status: 429, message: "Too many requests" }, expected: ErrorKind.RATE_LIMIT_ERROR },
  { label: "network", error: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }), expected: ErrorKind.NETWORK_ERROR },
  { label: "timeout", error: Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }), expected: ErrorKind.TIMEOUT_ERROR },
  { label: "safety", error: new Error("Safety filter blocked the response"), expected: ErrorKind.SAFETY_ERROR },
  { label: "parse", error: new SyntaxError("Invalid JSON response"), expected: ErrorKind.PARSE_ERROR },
  { label: "validation", error: { name: "ZodError", message: "Validation error: invalid input" }, expected: ErrorKind.VALIDATION_ERROR },
  { label: "file", error: Object.assign(new Error("file not found"), { code: "ENOENT" }), expected: ErrorKind.FILE_ERROR },
  { label: "permission", error: Object.assign(new Error("permission denied"), { code: "EACCES" }), expected: ErrorKind.PERMISSION_ERROR },
  { label: "Docker", error: new Error("Docker daemon unavailable"), expected: ErrorKind.DOCKER_ERROR },
  { label: "Git", error: new Error("git repository not found"), expected: ErrorKind.GIT_ERROR },
  { label: "memory", error: new Error("memory service unavailable"), expected: ErrorKind.MEMORY_ERROR },
  { label: "provider", error: new Error("GoogleGenerativeAI provider error"), expected: ErrorKind.PROVIDER_ERROR },
  { label: "unknown", error: new Error("unclassified failure"), expected: ErrorKind.UNKNOWN_ERROR },
];

describe("ErrorTranslator", (): void => {
  for (const testCase of classificationCases) {
    it(`classifies ${testCase.label} errors`, (): void => {
      expect(ErrorTranslator.translate(testCase.error).kind).toBe(testCase.expected);
    });
  }

  it("extracts nested cause messages and classifies their error code", (): void => {
    const inner = Object.assign(new Error("connection refused by upstream"), { code: "ECONNREFUSED" });
    const middle = Object.assign(new Error("provider request failed"), { cause: inner });
    const outer = Object.assign(new Error("agent call failed"), { cause: middle });

    const translated = ErrorTranslator.translate(outer);

    expect(translated.kind).toBe(ErrorKind.NETWORK_ERROR);
    expect(translated.originalMessage).toContain("agent call failed");
    expect(translated.originalMessage).toContain("connection refused by upstream");
    expect(translated.retryable).toBe(true);
    expect(translated.stack).toContain("agent call failed");
  });

  it("handles strings, plain objects, and null without throwing", (): void => {
    expect(ErrorTranslator.translate("plain failure").originalMessage).toBe("plain failure");
    expect(ErrorTranslator.translate({ error: { message: "nested failure" } }).originalMessage).toContain("nested failure");
    expect(ErrorTranslator.translate(null).kind).toBe(ErrorKind.UNKNOWN_ERROR);
  });

  it("marks only retryable categories as retryable", (): void => {
    expect(ErrorTranslator.translate({ status: 429 }).retryable).toBe(true);
    expect(ErrorTranslator.translate({ code: "ECONNREFUSED" }).retryable).toBe(true);
    expect(ErrorTranslator.translate({ code: "ETIMEDOUT" }).retryable).toBe(true);
    expect(ErrorTranslator.translate(new Error("invalid credentials")).retryable).toBe(false);
    expect(ErrorTranslator.translate(new Error("unclassified failure")).retryable).toBe(false);
  });

  it("handles cyclic error objects during deep extraction", (): void => {
    const error: { message: string; cause?: unknown } = { message: "outer failure" };
    error.cause = error;

    expect(ErrorTranslator.translate(error).originalMessage).toBe("outer failure");
  });
});
