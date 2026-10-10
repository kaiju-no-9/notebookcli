export type Part =
  | { text: string }
  | { functionCall: { id?: string; name: string; args: Record<string, unknown> } }
  | { functionResponse: { toolCallId?: string; name: string; response: string } };

export interface Message {
  role: "user" | "model" | "tool";
  parts: Part[];
  agentName?: string;
  runID?: string;
}
