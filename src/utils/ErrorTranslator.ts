export enum ErrorKind {
  AUTH_ERROR = "AUTH_ERROR",
  RATE_LIMIT_ERROR = "RATE_LIMIT_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  SAFETY_ERROR = "SAFETY_ERROR",
  PARSE_ERROR = "PARSE_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  FILE_ERROR = "FILE_ERROR",
  PERMISSION_ERROR = "PERMISSION_ERROR",
  DOCKER_ERROR = "DOCKER_ERROR",
  GIT_ERROR = "GIT_ERROR",
  MEMORY_ERROR = "MEMORY_ERROR",
  PROVIDER_ERROR = "PROVIDER_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

export interface ErrorInfo {
  readonly kind: ErrorKind;
  readonly message: string;
  readonly originalMessage: string;
  readonly stack?: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
}

interface ErrorFacts {
  readonly messages: string[];
  readonly codes: string[];
  readonly statuses: number[];
  readonly stack?: string;
}

const USER_MESSAGES: Record<ErrorKind, string> = {
  [ErrorKind.AUTH_ERROR]: "Authentication failed. Check your credentials.",
  [ErrorKind.RATE_LIMIT_ERROR]: "The service rate limit was reached.",
  [ErrorKind.NETWORK_ERROR]: "A network connection error occurred.",
  [ErrorKind.TIMEOUT_ERROR]: "The operation timed out.",
  [ErrorKind.SAFETY_ERROR]: "The request was blocked by a safety policy.",
  [ErrorKind.PARSE_ERROR]: "The response could not be parsed.",
  [ErrorKind.VALIDATION_ERROR]: "The input did not pass validation.",
  [ErrorKind.FILE_ERROR]: "A file operation failed.",
  [ErrorKind.PERMISSION_ERROR]: "Permission was denied.",
  [ErrorKind.DOCKER_ERROR]: "The Docker operation failed.",
  [ErrorKind.GIT_ERROR]: "The Git operation failed.",
  [ErrorKind.MEMORY_ERROR]: "The memory service operation failed.",
  [ErrorKind.PROVIDER_ERROR]: "The AI provider request failed.",
  [ErrorKind.UNKNOWN_ERROR]: "An unexpected error occurred.",
};

const RETRYABLE_KINDS: ReadonlySet<ErrorKind> = new Set([
  ErrorKind.RATE_LIMIT_ERROR,
  ErrorKind.NETWORK_ERROR,
  ErrorKind.TIMEOUT_ERROR,
]);

const ERROR_PROPERTY_KEYS: readonly string[] = [
  "message",
  "code",
  "errno",
  "status",
  "statusCode",
  "status_code",
  "name",
  "details",
  "error",
  "cause",
  "response",
  "body",
  "reason",
  "errors",
];

export class ErrorTranslator {
  public static translate(error: unknown): ErrorInfo {
    const facts = ErrorTranslator.extractFacts(error);
    const originalMessage = facts.messages.join(" | ") || "Unknown error";
    const kind = ErrorTranslator.classify(facts);
    const info: ErrorInfo = {
      kind,
      message: USER_MESSAGES[kind],
      originalMessage,
      retryable: RETRYABLE_KINDS.has(kind),
    };

    if (facts.stack !== undefined) {
      return { ...info, stack: facts.stack };
    }

    return info;
  }

  private static extractFacts(error: unknown): ErrorFacts {
    const messages: string[] = [];
    const codes: string[] = [];
    const statuses: number[] = [];
    const seen = new WeakSet<object>();
    const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
    let stack: string | undefined;
    let visited = 0;

    while (queue.length > 0 && visited < 100) {
      const current = queue.shift();
      if (current === undefined || current.depth > 8) {
        continue;
      }
      visited += 1;

      if (typeof current.value === "string") {
        ErrorTranslator.addUnique(messages, current.value);
        continue;
      }
      if (typeof current.value === "number") {
        if (Number.isInteger(current.value) && current.value >= 100 && current.value <= 599) {
          ErrorTranslator.addUniqueNumber(statuses, current.value);
        }
        continue;
      }
      if (typeof current.value !== "object" || current.value === null) {
        continue;
      }
      if (seen.has(current.value)) {
        continue;
      }
      seen.add(current.value);

      const objectValue = current.value;
      const message = ErrorTranslator.readProperty(objectValue, "message");
      if (typeof message === "string") {
        ErrorTranslator.addUnique(messages, message);
      }
      const code = ErrorTranslator.readProperty(objectValue, "code");
      const errno = ErrorTranslator.readProperty(objectValue, "errno");
      if (typeof code === "string" || typeof code === "number") {
        ErrorTranslator.addUnique(codes, String(code));
      }
      if (typeof errno === "string" || typeof errno === "number") {
        ErrorTranslator.addUnique(codes, String(errno));
      }

      for (const key of ["status", "statusCode", "status_code"]) {
        const status = ErrorTranslator.readProperty(objectValue, key);
        const numericStatus = typeof status === "number" ? status : Number(status);
        if (Number.isInteger(numericStatus) && numericStatus >= 100 && numericStatus <= 599) {
          ErrorTranslator.addUniqueNumber(statuses, numericStatus);
        }
      }

      if (stack === undefined) {
        const stackValue = ErrorTranslator.readProperty(objectValue, "stack");
        if (typeof stackValue === "string") {
          stack = stackValue;
        }
      }

      for (const key of ERROR_PROPERTY_KEYS) {
        const nested = ErrorTranslator.readProperty(objectValue, key);
        if (nested !== undefined && nested !== objectValue) {
          queue.push({ value: nested, depth: current.depth + 1 });
        }
      }
      if (Array.isArray(objectValue)) {
        for (const nested of objectValue.slice(0, 20)) {
          queue.push({ value: nested, depth: current.depth + 1 });
        }
      }
    }

    return stack === undefined
      ? { messages, codes, statuses }
      : { messages, codes, statuses, stack };
  }

  private static readProperty(value: object, key: string): unknown {
    try {
      return Reflect.get(value, key) as unknown;
    } catch {
      return undefined;
    }
  }

  private static addUnique(values: string[], value: string): void {
    const normalized = value.trim();
    if (normalized.length > 0 && !values.includes(normalized)) {
      values.push(normalized.slice(0, 2000));
    }
  }

  private static addUniqueNumber(values: number[], value: number): void {
    if (!values.includes(value)) {
      values.push(value);
    }
  }

  private static classify(facts: ErrorFacts): ErrorKind {
    const text = [...facts.messages, ...facts.codes].join(" ").toLowerCase();
    const codeSet = new Set(facts.codes.map((code) => code.toUpperCase()));
    const hasStatus = (...expected: number[]): boolean =>
      expected.some((status) => facts.statuses.includes(status));
    const hasCode = (...expected: string[]): boolean =>
      expected.some((code) => codeSet.has(code));
    const hasText = (...patterns: RegExp[]): boolean =>
      patterns.some((pattern) => pattern.test(text));

    // Specific codes and status values take precedence over broad message matches.
    if (hasStatus(408) || hasCode("ETIMEDOUT", "ESOCKETTIMEDOUT", "DEADLINE_EXCEEDED") || hasText(/\btime(?:d\s*out|out)\b/, /deadline exceeded/)) {
      return ErrorKind.TIMEOUT_ERROR;
    }
    if (hasStatus(429) || hasCode("RESOURCE_EXHAUSTED") || hasText(/rate.?limit/, /too many requests/)) {
      return ErrorKind.RATE_LIMIT_ERROR;
    }
    if (hasStatus(401) || hasCode("UNAUTHENTICATED") || hasText(/unauthori[sz]ed/, /authentication failed/, /invalid api key/, /invalid credentials/)) {
      return ErrorKind.AUTH_ERROR;
    }
    if (hasText(/safety filter/, /safety block/, /blocked by safety/, /content filter/)) {
      return ErrorKind.SAFETY_ERROR;
    }
    if (hasText(/syntaxerror/, /parse error/, /failed to parse/, /malformed json/, /invalid json/)) {
      return ErrorKind.PARSE_ERROR;
    }
    if (hasCode("ZOD_ERROR", "INVALID_ARGUMENT") || hasStatus(400, 422) || hasText(/validation error/, /invalid input/, /schema validation/)) {
      return ErrorKind.VALIDATION_ERROR;
    }
    if (hasCode("ENOENT", "EISDIR", "ENOTDIR", "EEXIST", "ENOSPC", "EMFILE") || hasText(/file not found/, /no such file or directory/)) {
      return ErrorKind.FILE_ERROR;
    }
    if (hasCode("EACCES", "EPERM") || hasText(/permission denied/, /operation not permitted/)) {
      return ErrorKind.PERMISSION_ERROR;
    }
    if (hasText(/docker/, /container daemon/)) {
      return ErrorKind.DOCKER_ERROR;
    }
    if (hasText(/\bgit\b/, /repository not found/, /not a git repository/)) {
      return ErrorKind.GIT_ERROR;
    }
    if (hasText(/memory service/, /memory api/, /saved memory/)) {
      return ErrorKind.MEMORY_ERROR;
    }
    if (hasCode("ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN") || hasText(/network error/, /fetch failed/, /connection refused/, /connection reset/, /dns lookup failed/)) {
      return ErrorKind.NETWORK_ERROR;
    }
    if (hasText(/google.?generative.?ai/, /gemini api/, /llm provider/, /provider error/)) {
      return ErrorKind.PROVIDER_ERROR;
    }

    return ErrorKind.UNKNOWN_ERROR;
  }
}
