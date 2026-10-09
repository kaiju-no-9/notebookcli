export type Part =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: string } };

export interface Message {
  role: "user" | "model" | "tool";
  parts: Part[];
  agentName?: string;
  runID?: string;
}
