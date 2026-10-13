import { randomUUID } from "node:crypto";
import type { RunLimits } from "../config/RunLimits.js";
import { ErrorKind, ErrorTranslator } from "./ErrorTranslator.js";

export interface ModelUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly startedAt: number;
  readonly requestAttempts: number;
  readonly successfulResponses: number;
  readonly retries: number;
  readonly toolInvocations: number;
  readonly observedTokens: number;
  readonly estimatedTokens: number;
  readonly stopReason?: string;
}

export class RunBudgetError extends Error {
  public readonly kind = ErrorKind.BUDGET_ERROR;

  public constructor(reason: string) {
    super(`Run stopped: ${reason}`);
    this.name = "RunBudgetError";
  }
}

export class RunContext {
  public readonly runId: string;
  public readonly startedAt: number;
  private requestAttempts = 0;
  private successfulResponses = 0;
  private retries = 0;
  private toolInvocations = 0;
  private observedTokens = 0;
  private estimatedTokens = 0;
  private reservedTokens = 0;
  private stopReason: string | undefined;

  public constructor(
    public readonly limits: RunLimits,
    private readonly now: () => number = Date.now,
    private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds: number): Promise<void> =>
      new Promise((resolve): void => { setTimeout(resolve, milliseconds); }),
    private readonly random: () => number = Math.random,
  ) {
    this.runId = randomUUID();
    this.startedAt = now();
  }

  public get maxOutputTokens(): number {
    return this.limits.maxOutputTokens;
  }

  public async requestModel<T>(
    messages: readonly unknown[],
    outputReservation: number,
    send: (signal: AbortSignal) => Promise<T>,
    readUsage: (response: T) => ModelUsage | undefined,
    allowRetries: boolean = true,
  ): Promise<T> {
    const inputEstimate = estimateInputTokens(messages);
    const reservation = inputEstimate + outputReservation;
    let attempt = 0;

    while (true) {
      this.assertCanContinue(reservation);
      this.requestAttempts += 1;
      this.reservedTokens += reservation;
      const controller = new AbortController();
      const remainingMs = Math.max(1, this.limits.maxDurationMs - (this.now() - this.startedAt));
      const timer = setTimeout((): void => controller.abort(new RunBudgetError("maximum run duration reached")), remainingMs);
      try {
        const response = await send(controller.signal);
        this.assertWithinDuration();
        this.reservedTokens -= reservation;
        this.successfulResponses += 1;
        const usage = readUsage(response);
        if (usage !== undefined && usage.totalTokens > 0) {
          this.observedTokens += usage.totalTokens;
        } else {
          this.estimatedTokens += reservation;
        }
        return response;
      } catch (error: unknown) {
        this.reservedTokens -= reservation;
        this.estimatedTokens += reservation;
        if (controller.signal.aborted && controller.signal.reason instanceof RunBudgetError) {
          this.stopReason = controller.signal.reason.message;
          throw controller.signal.reason;
        }
        if (error instanceof RunBudgetError) {
          this.stopReason = error.message;
          throw error;
        }
        const errorInfo = ErrorTranslator.translate(error);
        const retryable = errorInfo.retryable && errorInfo.kind !== ErrorKind.QUOTA_EXCEEDED;
        if (!retryable || !allowRetries || attempt >= this.limits.maxRetries) {
          throw error;
        }
        const delay = this.retryDelay(attempt, errorInfo.retryAfterMs);
        if (delay > this.limits.maxRetryDelayMs || delay >= this.remainingDurationMs()) {
          throw error;
        }
        attempt += 1;
        this.retries += 1;
        await this.sleep(delay);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  public recordToolInvocation(): void {
    this.assertWithinDuration();
    if (this.toolInvocations >= this.limits.maxToolInvocations) {
      this.stopReason = `tool invocation budget exhausted (${this.toolInvocations}/${this.limits.maxToolInvocations})`;
      throw new RunBudgetError(this.stopReason);
    }
    this.toolInvocations += 1;
  }

  public assertCanContinue(reservation = 0): void {
    this.assertWithinDuration();
    if (this.requestAttempts >= this.limits.maxLLMRequests) {
      this.stopReason = `LLM request budget exhausted (${this.requestAttempts}/${this.limits.maxLLMRequests})`;
      throw new RunBudgetError(this.stopReason);
    }
    if (this.observedTokens + this.estimatedTokens + this.reservedTokens + reservation > this.limits.maxTokens) {
      this.stopReason = `token budget would be exceeded (${this.observedTokens + this.estimatedTokens + this.reservedTokens + reservation}/${this.limits.maxTokens} estimated or observed tokens)`;
      throw new RunBudgetError(this.stopReason);
    }
  }

  public snapshot(): RunSnapshot {
    return {
      runId: this.runId,
      startedAt: this.startedAt,
      requestAttempts: this.requestAttempts,
      successfulResponses: this.successfulResponses,
      retries: this.retries,
      toolInvocations: this.toolInvocations,
      observedTokens: this.observedTokens,
      estimatedTokens: this.estimatedTokens,
      ...(this.stopReason === undefined ? {} : { stopReason: this.stopReason }),
    };
  }

  private assertWithinDuration(): void {
    if (this.now() - this.startedAt >= this.limits.maxDurationMs) {
      this.stopReason = `maximum run duration reached (${this.limits.maxDurationMs} ms)`;
      throw new RunBudgetError(this.stopReason);
    }
  }

  private remainingDurationMs(): number {
    return Math.max(0, this.limits.maxDurationMs - (this.now() - this.startedAt));
  }

  private retryDelay(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) {
      return retryAfterMs;
    }
    const exponential = Math.min(this.limits.maxRetryDelayMs, 250 * (2 ** attempt));
    return Math.round(exponential * (0.5 + this.random()));
  }
}

export function estimateInputTokens(messages: readonly unknown[]): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(messages);
  } catch {
    serialized = String(messages);
  }
  return Math.ceil(serialized.length / 3) + messages.length * 4;
}
