import { createLogger, format, transports, type Logger } from "winston";

const SECRET_PATTERNS: readonly RegExp[] = [
  /AIza[0-9A-Za-z_-]{35}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g,
  /-----BEGIN (?:RSA|EC|DSA) PRIVATE KEY-----/g,
];

type LogMeta = Record<string, unknown>;

function redactString(value: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted: string, pattern: RegExp): string => redacted.replace(pattern, "[REDACTED]"),
    value,
  );
}

function sanitize(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (depth >= 10) {
    return "[MaxDepth]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => sanitize(item, seen, depth + 1));
  }
  const sanitized: LogMeta = {};
  try {
    for (const [key, item] of Object.entries(value)) {
      sanitized[key] = sanitize(item, seen, depth + 1);
    }
  } catch {
    return "[Unserializable]";
  }
  return sanitized;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "[Unserializable metadata]";
  }
}

let logger: Logger | undefined;
let currentLevel: "debug" | "info" | "warn" | "error" = "info";

function getLogger(): Logger {
  if (logger === undefined) {
    logger = createLogger({
      level: currentLevel,
      format: format.combine(
        format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
        format.printf((info): string => {
          const level = String(info.level ?? "info").toUpperCase();
          const message = typeof info.message === "string" ? redactString(info.message) : "[Invalid log message]";
          const meta: LogMeta = {};
          for (const [key, value] of Object.entries(info)) {
            if (key !== "level" && key !== "message" && key !== "timestamp") {
              meta[key] = sanitize(value, new WeakSet<object>(), 0);
            }
          }
          const suffix = Object.keys(meta).length > 0 ? ` ${safeJson(meta)}` : "";
          return `[${String(info.timestamp)}] [${level}] ${message}${suffix}`;
        }),
      ),
      transports: [new transports.Console({ stderrLevels: ["error", "warn", "info", "debug"] })],
      exitOnError: false,
    });
  }
  return logger;
}

// Initialize Winston before the first log call so cold-start setup does not
// block an application's request or the first guarded operation.
getLogger();

export class AgentLogger {
  public static info(message: string, meta?: LogMeta): void {
    AgentLogger.write("info", message, meta);
  }

  public static warn(message: string, meta?: LogMeta): void {
    AgentLogger.write("warn", message, meta);
  }

  public static error(message: string, meta?: LogMeta): void {
    AgentLogger.write("error", message, meta);
  }

  public static debug(message: string, meta?: LogMeta): void {
    AgentLogger.write("debug", message, meta);
  }

  public static setLevel(level: "debug" | "info" | "warn" | "error"): void {
    try {
      currentLevel = level;
      if (logger !== undefined) {
        logger.level = level;
      }
    } catch {
      // Logging configuration must never crash an application.
    }
  }

  private static write(level: "info" | "warn" | "error" | "debug", message: string, meta?: LogMeta): void {
    try {
      if (typeof message !== "string") {
        getLogger().log({ level, message: "[Invalid log message]" });
        return;
      }
      getLogger().log({ level, message, meta: meta ?? {} });
    } catch {
      // Logger failures are intentionally swallowed to protect application flow.
    }
  }
}
