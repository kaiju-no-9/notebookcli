export interface GuardrailResult {
  allowed: boolean;
  reason: string;
  confidence: number;
  stage: string;
}
