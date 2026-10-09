import type { Message } from "../../agent/Message.js";

export interface GuardrailContext {
  userMessage: string;
  conversationHistory?: Message[];
  metadata?: Record<string, unknown>;
}
