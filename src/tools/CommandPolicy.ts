export type CommandAction = "ALLOW" | "BLOCK" | "CONFIRM";

export interface CommandClassification {
  readonly action: CommandAction;
  readonly reason: string;
}

const SAFE_COMMANDS = new Set([
  "ls", "cat", "echo", "pwd", "node", "npm", "npx", "bun", "bunx", "git", "python3", "pip",
  "grep", "find", "head", "tail", "wc", "sort", "uniq", "which", "env", "mkdir", "touch", "cp",
]);
const FORK_BOMB = /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/;
const BLOCKED_COMMANDS = new Set(["mkfs", "dd", "shutdown", "reboot", "halt"]);
const CONTROL_SEPARATOR = /(?:&&|\|\||[;|])/;

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else {
        token += character;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token.length > 0) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }
  if (escaped) {
    token += "\\";
  }
  if (token.length > 0) {
    tokens.push(token);
  }
  return tokens;
}

function classifySegment(segment: string): CommandClassification {
  const tokens = tokenize(segment.trim());
  if (tokens.length === 0) {
    return { action: "BLOCK", reason: "Empty command segment" };
  }
  const executable = tokens[0] ?? "";
  const baseCommand = executable.split("/").at(-1)?.toLowerCase() ?? "";
  const argumentsText = tokens.slice(1).join(" ");

  if (baseCommand === "rm" && /(?:^|\s)-[^\s]*r[^\s]*f|(?:^|\s)-[^\s]*f[^\s]*r/.test(argumentsText)) {
    if (/(?:^|\s)(?:\/|--no-preserve-root)(?:\s|$)/.test(argumentsText)) {
      return { action: "BLOCK", reason: "Recursive deletion of the filesystem root is blocked" };
    }
    return { action: "CONFIRM", reason: "Recursive deletion requires confirmation" };
  }
  if (BLOCKED_COMMANDS.has(baseCommand)) {
    return { action: "BLOCK", reason: `${baseCommand} is blocked` };
  }
  if (baseCommand === "git" && /(?:^|\s)push\b[^\n]*(?:--force\b|-f\b)|(?:^|\s)reset\b[^\n]*(?:--hard\b)/i.test(segment)) {
    return { action: "BLOCK", reason: "Force push and hard reset are blocked" };
  }
  if (baseCommand === "sudo" || (baseCommand === "chmod" && /(?:^|\s)777(?:\s|$)/.test(argumentsText))) {
    return { action: "CONFIRM", reason: `${baseCommand} requires confirmation` };
  }

  const tokensFolded = tokens.map((part: string): string => part.toLowerCase());
  if ((baseCommand === "curl" || baseCommand === "wget") && CONTROL_SEPARATOR.test(segment)) {
    return { action: "CONFIRM", reason: "Piping downloaded content to a shell requires confirmation" };
  }
  if (!SAFE_COMMANDS.has(baseCommand)) {
    return { action: "CONFIRM", reason: `Command '${baseCommand}' is not on the safe command list` };
  }
  if (baseCommand === "git" && tokensFolded.some((part: string): boolean => part === "--force" || part === "-f") && tokensFolded.includes("push")) {
    return { action: "BLOCK", reason: "Force push is blocked" };
  }
  return { action: "ALLOW", reason: `${baseCommand} is on the safe command list` };
}

export class CommandPolicy {
  public static classify(command: string): CommandClassification {
    const trimmed = command.trim();
    if (trimmed.length === 0) {
      return { action: "BLOCK", reason: "Command is empty" };
    }
    if (FORK_BOMB.test(trimmed)) {
      return { action: "BLOCK", reason: "Fork bomb pattern is blocked" };
    }
    if (/\brm\s+-[^\n]*r[^\n]*f\s+(?:\/|--no-preserve-root)(?:\s|$)/i.test(trimmed)) {
      return { action: "BLOCK", reason: "Recursive deletion of the filesystem root is blocked" };
    }
    if (/\b(?:curl|wget)\b[^\n]*(?:\||\|\|)[^\n]*\b(?:sh|bash)\b/i.test(trimmed)) {
      return { action: "CONFIRM", reason: "Piping downloaded content to a shell requires confirmation" };
    }
    const segments = trimmed.split(CONTROL_SEPARATOR).map((segment: string): string => segment.trim()).filter(Boolean);
    let confirmation: CommandClassification | undefined;
    for (const segment of segments) {
      const result = classifySegment(segment);
      if (result.action === "BLOCK") {
        return result;
      }
      if (result.action === "CONFIRM") {
        confirmation = result;
      }
    }
    return confirmation ?? { action: "ALLOW", reason: "All commands are on the safe command list" };
  }
}
