import type { Message } from "../../agent/Message.js";
import type { RunContext } from "../../utils/RunContext.js";

export interface GuardrailContext {
  userMessage: string;
  conversationHistory?: Message[];
  metadata?: Record<string, unknown>;
  runContext?: RunContext;
}
