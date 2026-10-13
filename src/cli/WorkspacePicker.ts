import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { ConfigManager } from "../config/ConfigManager.js";
import { getInquirerPrompts, isPromptCancelled } from "./commands/SetupPrompts.js";

const RECENT_WORKSPACES_KEY = "ODEN_RECENT_WORKSPACES";
const MAX_RECENT_WORKSPACES = 5;

export interface WorkspacePickerStore {
  getStored(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export interface WorkspacePickerPrompts {
  choose(choices: readonly { readonly value: string; readonly name: string }[]): Promise<string>;
  enterPath(currentDirectory: string): Promise<string>;
  chooseNative(currentDirectory: string): Promise<NativeFolderChoice>;
}

export type NativeFolderChoice =
  | { readonly status: "selected"; readonly path: string }
  | { readonly status: "cancelled" }
  | { readonly status: "unavailable" };

interface DialogProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runDialog(command: string, args: string[]): Promise<DialogProcessResult | undefined> {
  try {
    const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function chooseNativeFolder(currentDirectory: string): Promise<NativeFolderChoice> {
  if (process.platform === "darwin") {
    const result = await runDialog("osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose an Oden project folder")']);
    if (result === undefined) return { status: "unavailable" };
    if (result.exitCode === 0 && result.stdout.length > 0) return { status: "selected", path: result.stdout };
    return /user canceled|error -128/i.test(result.stderr) ? { status: "cancelled" } : { status: "unavailable" };
  }

  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Choose an Oden project folder'",
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) } else { exit 2 }",
    ].join("; ");
    const result = await runDialog("powershell.exe", ["-NoProfile", "-STA", "-Command", script]);
    if (result === undefined) return { status: "unavailable" };
    return result.exitCode === 0 && result.stdout.length > 0
      ? { status: "selected", path: result.stdout }
      : result.exitCode === 2 ? { status: "cancelled" } : { status: "unavailable" };
  }

  if (process.platform === "linux") {
    const zenity = await runDialog("zenity", [
      "--file-selection", "--directory", "--title=Choose an Oden project folder", `--filename=${path.join(currentDirectory, "")}`,
    ]);
    if (zenity !== undefined) {
      if (zenity.exitCode === 0 && zenity.stdout.length > 0) return { status: "selected", path: zenity.stdout };
      if (zenity.exitCode === 1 && zenity.stderr.length === 0) return { status: "cancelled" };
    }
    const kdialog = await runDialog("kdialog", ["--getexistingdirectory", currentDirectory, "--title", "Choose an Oden project folder"]);
    if (kdialog !== undefined) {
      if (kdialog.exitCode === 0 && kdialog.stdout.length > 0) return { status: "selected", path: kdialog.stdout };
      if (kdialog.exitCode === 1 && kdialog.stderr.length === 0) return { status: "cancelled" };
    }
  }

  return { status: "unavailable" };
}

const terminalPrompts: WorkspacePickerPrompts = {
  choose: async (choices): Promise<string> => {
    const { select } = await getInquirerPrompts();
    return select({ message: "Choose a project workspace:", choices: [...choices] });
  },
  enterPath: async (currentDirectory): Promise<string> => {
    const { input } = await getInquirerPrompts();
    return input({
      message: "Native folder dialog unavailable. Enter a project folder path:",
      default: currentDirectory,
      validate: (value: string): true | string => {
        try {
          const resolved = realpathSync(path.resolve(value));
          return statSync(resolved).isDirectory() ? true : "Choose an existing folder.";
        } catch {
          return "Folder not found or not accessible. Enter an existing folder path.";
        }
      },
    });
  },
  chooseNative: chooseNativeFolder,
};

function canonicalDirectory(candidate: string): string | undefined {
  try {
    const resolved = realpathSync(path.resolve(candidate));
    return statSync(resolved).isDirectory() ? resolved : undefined;
  } catch {
    return undefined;
  }
}

async function recentDirectories(store: WorkspacePickerStore): Promise<string[]> {
  const stored = await store.getStored(RECENT_WORKSPACES_KEY);
  if (stored === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || !parsed.every((entry: unknown): entry is string => typeof entry === "string")) return [];
    return parsed.map(canonicalDirectory).filter((entry): entry is string => entry !== undefined).slice(0, MAX_RECENT_WORKSPACES);
  } catch {
    return [];
  }
}

async function rememberDirectory(store: WorkspacePickerStore, selected: string): Promise<void> {
  try {
    const recent = await recentDirectories(store);
    await store.set(RECENT_WORKSPACES_KEY, JSON.stringify([selected, ...recent.filter((entry): boolean => entry !== selected)].slice(0, MAX_RECENT_WORKSPACES)));
  } catch {
    // Recent workspaces are a convenience; storage failure must not block startup.
  }
}

export async function chooseWorkspace(
  currentDirectory: string = process.cwd(),
  store: WorkspacePickerStore = ConfigManager,
  prompts: WorkspacePickerPrompts = terminalPrompts,
): Promise<string | undefined> {
  const current = canonicalDirectory(currentDirectory);
  if (current === undefined) throw new Error(`Current directory is not an accessible folder: ${currentDirectory}`);

  try {
    const recent = (await recentDirectories(store)).filter((entry): boolean => entry !== current);
    const choices = [
      { value: current, name: `Current folder  ${current}` },
      ...recent.map((entry): { value: string; name: string } => ({ value: entry, name: `Recent  ${entry}` })),
      { value: "__native_picker__", name: "Browse for a folder in the system dialog" },
      { value: "__enter_path__", name: "Enter a project folder path" },
      { value: "__quit__", name: "Cancel startup" },
    ];
    const selected = await prompts.choose(choices);
    if (selected === "__quit__") return undefined;
    let candidate: string;
    if (selected === "__enter_path__") {
      candidate = await prompts.enterPath(current);
    } else if (selected === "__native_picker__") {
      const result = await prompts.chooseNative(current);
      if (result.status === "cancelled") return undefined;
      candidate = result.status === "selected" ? result.path : await prompts.enterPath(current);
    } else {
      candidate = selected;
    }
    const resolved = canonicalDirectory(candidate);
    if (resolved === undefined) throw new Error(`Selected workspace is not an accessible folder: ${candidate}`);
    await rememberDirectory(store, resolved);
    return resolved;
  } catch (error: unknown) {
    if (isPromptCancelled(error)) return undefined;
    throw error;
  }
}
