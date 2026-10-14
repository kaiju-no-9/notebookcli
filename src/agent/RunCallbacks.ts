export type ToolActivityStatus = "running" | "completed" | "failed";

export interface RunCallbacks {
  onStatus?: (status: string) => void;
  onToken?: (token: string) => void;
  onToolStatus?: (toolName: string, status: ToolActivityStatus) => void;
}
