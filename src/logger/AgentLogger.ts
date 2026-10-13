const SECRET_PATTERNS: readonly RegExp[] = [
  /AIza[0-9A-Za-z_-]{35}/g,
  /AQ\.[A-Za-z0-9._-]{8,}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g,
  /-----BEGIN (?:RSA|EC|DSA) PRIVATE KEY-----/g,
];

type LogMeta = Record<string, unknown>;
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let currentLevel: LogLevel = "info";

function redactString(value: string): string {
  return SECRET_PATTERNS.reduce((redacted: string, pattern: RegExp): string => redacted.replace(pattern, "[REDACTED]"), value);
}

function sanitize(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= 10) return "[MaxDepth]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item: unknown): unknown => sanitize(item, seen, depth + 1));
  const sanitized: LogMeta = {};
  try {
    for (const [key, item] of Object.entries(value)) sanitized[key] = sanitize(item, seen, depth + 1);
  } catch {
    return "[Unserializable]";
  }
  return sanitized;
}

function formatLog(level: LogLevel, message: string, meta?: LogMeta): string {
  const safeMessage = redactString(message);
  const safeMeta = meta === undefined ? {} : sanitize(meta, new WeakSet<object>(), 0);
  const suffix = typeof safeMeta === "object" && safeMeta !== null && Object.keys(safeMeta).length > 0
    ? ` ${JSON.stringify(safeMeta)}`
    : "";
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${safeMessage}${suffix}\n`;
}

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

  public static setLevel(level: LogLevel): void {
    currentLevel = level;
  }

  private static write(level: LogLevel, message: string, meta?: LogMeta): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[currentLevel]) return;
    try {
      const output = formatLog(level, typeof message === "string" ? message : "[Invalid log message]", meta);
      process.stderr.write(output);
    } catch {
      // Logging must not interrupt application behavior.
    }
  }
}
