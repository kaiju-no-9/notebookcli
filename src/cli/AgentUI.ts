import { Chalk } from "chalk";
import path from "node:path";
import type { ToolActivityStatus } from "../agent/RunCallbacks.js";
import type { RunSnapshot } from "../utils/RunContext.js";

type Accent = "cyan" | "blue" | "green" | "yellow" | "red" | "magenta";
const ACCENT_HEX: Readonly<Record<Accent, string>> = {
  cyan: "#79CFE0",
  blue: "#91B8F5",
  green: "#82C99B",
  yellow: "#E8C77A",
  red: "#F07878",
  magenta: "#B39AE8",
};
interface StyledRow {
  readonly text: string;
  readonly accent: Accent;
}

export interface UIContext {
  readonly workspace?: string;
  readonly providerModel?: string;
  readonly sessionTitle?: string;
}

export class AgentUI {
  private readonly write: (text: string) => void;
  private readonly writeStream: (text: string) => void;
  private readonly chalk: Chalk;
  private readonly asciiOnly: boolean;
  private readonly interactiveTerminal: boolean;

  public constructor(write?: (text: string) => void, writeStream?: (text: string) => void) {
    this.write = write ?? ((text: string): void => { console.log(text); });
    this.writeStream = writeStream ?? (write === undefined
      ? (text: string): void => { process.stdout.write(text); }
      : write);
    this.interactiveTerminal = write === undefined && process.stdout.isTTY === true && process.env.TERM !== "dumb";
    this.asciiOnly = write === undefined && process.env.TERM === "dumb";
    const supportsColor = this.interactiveTerminal && process.env.NO_COLOR === undefined;
    const colorDepth = supportsColor ? process.stdout.getColorDepth() : 0;
    const colorLevel = colorDepth >= 24 ? 3 : colorDepth >= 8 ? 2 : colorDepth > 1 ? 1 : 0;
    this.chalk = new Chalk({ level: colorLevel });
  }

  public renderWelcome(context: UIContext): void {
    const projectName = context.workspace === undefined ? undefined : path.basename(context.workspace);
    const session = context.sessionTitle === undefined || context.sessionTitle.trim().length === 0
      ? undefined
      : this.shorten(context.sessionTitle, 34);
    const rows = [
      ...(projectName === undefined ? [] : [`PROJECT  ${projectName}`]),
      ...(context.providerModel === undefined ? [] : [`MODEL  ${context.providerModel}`]),
      ...(session === undefined ? [] : [`SESSION  ${session}`]),
      "READY  /help · exit",
    ];
    this.write(this.renderPanel("ODEN / CODING AGENT", rows, "cyan"));
  }

  public startLoading(): () => Promise<void> {
    if (!this.interactiveTerminal) return async (): Promise<void> => undefined;
    const terminalColumns = process.stdout.columns ?? 80;
    const logo = terminalColumns >= 40
      ? [
        " ██████╗ ██████╗ ███████╗███╗   ██╗",
        "██╔═══██╗██╔══██╗██╔════╝████╗  ██║",
        "██║   ██║██║  ██║█████╗  ██╔██╗ ██║",
        "██║   ██║██║  ██║██╔══╝  ██║╚██╗██║",
        "╚██████╔╝██████╔╝███████╗██║ ╚████║",
        " ╚═════╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝",
      ]
      : ["O D E N"];
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const startedAt = Date.now();
    const minimumDisplayMs = 800;
    let frameIndex = 0;
    let stopped = false;
    const renderFrame = (): string => {
      const frame = frames[frameIndex % frames.length] ?? ".";
      frameIndex += 1;
      return `${this.color("blue", frame)} Starting agent...`;
    };
    this.writeStream(`${logo.map((line): string => this.chalk.bold.cyan(line)).join("\n")}\n${renderFrame()}`);
    const timer = setInterval((): void => this.writeStream(`\r${renderFrame()}`), 90);
    return async (): Promise<void> => {
      if (stopped) return;
      const remainingMs = Math.max(0, minimumDisplayMs - (Date.now() - startedAt));
      if (remainingMs > 0) await new Promise<void>((resolve): void => { setTimeout(resolve, remainingMs); });
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      this.writeStream(`\u001b[${logo.length}A\r\u001b[J`);
    };
  }

  public render(response: string): void {
    this.write(response);
  }

  public renderResponse(response: string): void {
    this.write(`${this.chalk.bold.cyan("ODEN · RESPONSE")}\n${response}`);
  }

  public renderResponseStart(): void {
    this.writeStream(`\n${this.chalk.bold.cyan("ODEN · RESPONSE")}\n`);
  }

  public renderCommandResult(response: string): void {
    const lines = response.split("\n");
    const heading = lines.shift()?.trim() || "ODEN COMMAND";
    this.write(this.renderPanel(heading, lines, "cyan"));
  }

  public renderToken(token: string): void {
    this.writeStream(token);
  }

  public renderStatus(status: string): void {
    const indicator = this.statusIndicator(status);
    this.writeStream(`\n${indicator}\n`);
  }

  public renderToolStatus(toolName: string, status: ToolActivityStatus): void {
    const tag = this.toolTag(toolName);
    const marker = status === "running"
      ? this.color("blue", `${this.glyph("◌", "...")} RUNNING`)
      : status === "completed"
        ? this.color("green", `${this.glyph("✓", "[ok]")} DONE`)
        : this.color("red", `${this.glyph("✕", "[x]")} FAILED`);
    this.writeStream(`\n${this.color("magenta", tag)} ${marker}  ${toolName}\n`);
  }

  public renderError(message: string): void {
    this.writeStream(`\n${this.renderPanel(`${this.glyph("✕", "[x]")} ERROR`, [message], "red")}\n`);
  }

  public renderRunSummary(snapshot: RunSnapshot): void {
    const elapsedMs = Math.max(0, Date.now() - snapshot.startedAt);
    const rows = [
      this.meterRow("REQUESTS", snapshot.requestAttempts, snapshot.limits.maxLLMRequests, `${snapshot.requestAttempts} / ${snapshot.limits.maxLLMRequests} · ${snapshot.successfulResponses} successful`),
      this.meterRow("TOOLS", snapshot.toolInvocations, snapshot.limits.maxToolInvocations, `${snapshot.toolInvocations} / ${snapshot.limits.maxToolInvocations}`),
      this.meterRow("TOKENS", snapshot.observedTokens + snapshot.estimatedTokens, snapshot.limits.maxTokens,
        `${snapshot.observedTokens.toLocaleString()} observed + ~${snapshot.estimatedTokens.toLocaleString()} estimated / ${snapshot.limits.maxTokens.toLocaleString()}`),
      this.meterRow("TIME", elapsedMs, snapshot.limits.maxDurationMs,
        `${this.formatDuration(elapsedMs)} / ${this.formatDuration(snapshot.limits.maxDurationMs)}`),
      ...(snapshot.retries === 0 ? [] : [`RETRIES    ${snapshot.retries}`]),
      ...(snapshot.stopReason === undefined ? [] : [`STOP       ${snapshot.stopReason}`]),
    ];
    this.writeStream(`\n${this.renderPanel("RUN METRICS", rows, "blue")}\n`);
  }

  public finishStream(): void {
    this.writeStream("\n");
  }

  private statusIndicator(status: string): string {
    const value = status.trim();
    const normalized = value.toLowerCase();
    if (/\b(?:failed; continuing|no usable .* continuing|fallback)\b/.test(normalized)) {
      return this.activityLine("! FALLBACK", value, "yellow");
    }
    if (/\b(?:failed|error|blocked)\b/.test(normalized)) {
      return this.activityLine(`${this.glyph("✕", "[x]")} FAILED`, value, "red");
    }
    if (/\bsubagent\b.*\b(?:completed|succeeded|ready)\b/.test(normalized)) {
      return this.activityLine(`${this.glyph("✓", "[ok]")} SPECIALIST READY`, value, "green");
    }
    if (/\b(?:cancelled|canceled|interrupted)\b/.test(normalized)) {
      return this.activityLine(`${this.glyph("Ⅱ", "[cancelled]")} CANCELLED`, value, "yellow");
    }
    if (/\b(?:approval|required|waiting for approval)\b/.test(normalized)) {
      return this.activityLine("! APPROVAL REQUIRED", value, "yellow");
    }
    if (/\b(?:subagent|specialist|delegat)/.test(normalized)) {
      return this.activityLine(`${this.glyph("◌", "...")} SPECIALISTS`, value, "magenta");
    }
    if (/\bresearch/.test(normalized)) {
      return this.activityLine(`${this.glyph("◌", "...")} RESEARCH`, value, "blue");
    }
    if (/\b(?:streaming|response)/.test(normalized)) {
      return this.activityLine(`${this.glyph("◌", "...")} MODEL`, value, "cyan");
    }
    return this.activityLine(`${this.glyph("◌", "...")} WORKING`, value, "cyan");
  }

  private activityLine(label: string, detail: string, accent: Accent): string {
    return `${this.color(accent, `╎ ${label}`)}  ${detail}`;
  }

  private meterRow(label: string, current: number, maximum: number, value: string): StyledRow {
    const ratio = maximum <= 0 ? 0 : Math.max(0, Math.min(1, current / maximum));
    const width = 12;
    const filled = Math.round(ratio * width);
    const full = this.asciiOnly ? "#" : "█";
    const empty = this.asciiOnly ? "." : "░";
    const severity: Accent = ratio >= 0.8 ? "red" : ratio >= 0.5 ? "yellow" : "green";
    const bar = full.repeat(filled) + empty.repeat(width - filled);
    return { text: `${label.padEnd(9)} [${bar}]  ${value}`, accent: severity };
  }

  private renderPanel(title: string, rows: readonly (string | StyledRow)[], accent: Accent): string {
    const terminalColumns = process.stdout.columns ?? 80;
    const width = Math.max(24, Math.min(96, terminalColumns - 2));
    const contentWidth = width - 4;
    const wrappedRows = rows.flatMap((row): StyledRow[] => {
      const text = typeof row === "string" ? row : row.text;
      const rowAccent = typeof row === "string" ? undefined : row.accent;
      return this.wrap(text, contentWidth).map((line): StyledRow => ({ text: line, accent: rowAccent ?? "cyan" }));
    });
    const left = this.asciiOnly ? "+" : "╭";
    const right = this.asciiOnly ? "+" : "╮";
    const vertical = this.asciiOnly ? "|" : "│";
    const horizontal = this.asciiOnly ? "-" : "─";
    const bottomLeft = this.asciiOnly ? "+" : "╰";
    const bottomRight = this.asciiOnly ? "+" : "╯";
    const titleText = ` ${title} `;
    const topFill = horizontal.repeat(Math.max(0, width - titleText.length - 2));
    const output = [
      `${left}${this.color(accent, titleText)}${this.color(accent, topFill)}${right}`,
      ...wrappedRows.map((row): string => `${this.color(accent, vertical)} ${this.color(row.accent, row.text.padEnd(contentWidth))} ${this.color(accent, vertical)}`),
      `${bottomLeft}${this.color(accent, horizontal.repeat(width - 2))}${bottomRight}`,
    ];
    return output.join("\n");
  }

  private wrap(value: string, width: number): string[] {
    if (value.length === 0) return [""];
    const words = value.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if (line.length === 0) {
        line = word;
      } else if (line.length + word.length + 1 <= width) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
      while (line.length > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    if (line.length > 0) lines.push(line);
    return lines;
  }

  private toolTag(toolName: string): string {
    const normalized = toolName.toLowerCase();
    if (/write|create|delete|code_tool/.test(normalized)) return "[WRITE]";
    if (/memory/.test(normalized)) return "[MEMORY]";
    if (/search|web|tavily/.test(normalized)) return "[SEARCH]";
    if (/execute|command|shell/.test(normalized)) return "[CMD]";
    if (/git/.test(normalized)) return "[GIT]";
    return "[READ]";
  }

  private formatDuration(milliseconds: number): string {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`;
  }

  public shorten(value: string, maximumLength: number): string {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length <= maximumLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maximumLength - 1)).trimEnd()}…`;
  }

  private color(accent: Accent, value: string): string {
    return this.chalk.hex(ACCENT_HEX[accent])(value);
  }

  private glyph(unicode: string, ascii: string): string {
    return this.asciiOnly ? ascii : unicode;
  }
}
