import { SecretScanner } from "../guardrails/types/SecretScanner.js";

export interface MemoryRuleResult {
  readonly allowed: boolean;
  readonly reason: string;
}

const SENSITIVE_LABEL = /(?:password|passwd|secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private[_ -]?key)\s*[:=]/i;

export class MemorySearchRules {
  public static validateMemory(key: string, value: string): MemoryRuleResult {
    if (key.trim().length === 0 || value.trim().length === 0) {
      return { allowed: false, reason: "Memory key and value must not be empty" };
    }
    if (SENSITIVE_LABEL.test(`${key}\n${value}`) || SecretScanner.containsSecrets(`${key}\n${value}`)) {
      return { allowed: false, reason: "Memory appears to contain a password, API key, or token" };
    }
    return { allowed: true, reason: "Memory is safe to save" };
  }

  public static validateQuery(query: string): MemoryRuleResult {
    const normalized = query.trim();
    if (normalized.length < 2 || normalized.length > 500) {
      return { allowed: false, reason: "Memory search query must contain 2 to 500 characters" };
    }
    if (SecretScanner.containsSecrets(normalized) || SENSITIVE_LABEL.test(normalized)) {
      return { allowed: false, reason: "Memory search query must not contain credentials" };
    }
    return { allowed: true, reason: "Memory search query is valid" };
  }
}
