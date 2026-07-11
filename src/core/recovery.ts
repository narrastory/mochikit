/**
 * Error recovery & retry (tutorial s11).
 *
 * Three recovery paths:
 *   1. Transient (429/529)      → exponential backoff + jitter, fallback model after N
 *   2. Prompt too long          → reactive compaction once, then fail
 *   3. Output truncated         → escalate max_tokens (handled by the loop via stop_reason)
 */

import type { LLMClient, LLMCreateParams, LLMResponse } from './llm-client.js';
import type { ConversationContext } from './context.js';
import { reactiveCompact } from './compaction.js';

export interface RecoveryState {
  hasEscalated: boolean;
  recoveryCount: number;
  consecutiveOverload: number;
  hasReactiveCompacted: boolean;
  currentModel: string;
}

export function createRecoveryState(model: string): RecoveryState {
  return {
    hasEscalated: false,
    recoveryCount: 0,
    consecutiveOverload: 0,
    hasReactiveCompacted: false,
    currentModel: model,
  };
}

export interface RecoveryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fallbackModel?: string;
  overloadThreshold?: number;
}

const DEFAULTS: Required<Omit<RecoveryOptions, 'fallbackModel'>> = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 32_000,
  overloadThreshold: 3,
};

export class Recovery {
  private opts: Required<RecoveryOptions>;

  constructor(opts: RecoveryOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts } as Required<RecoveryOptions>;
  }

  /**
   * Call the LLM with retry/recovery. Mutates `params` (model/max_tokens) and
   * `ctx` (reactive compaction) as side effects of recovery.
   */
  async call(
    params: LLMCreateParams,
    llm: LLMClient,
    ctx: ConversationContext,
    state: RecoveryState,
  ): Promise<LLMResponse> {
    params.model = state.currentModel;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const res = await llm.create(params);
        state.consecutiveOverload = 0;
        return res;
      } catch (err) {
        state.recoveryCount++;
        if (isPromptTooLongError(err)) {
          if (state.hasReactiveCompacted) {
            throw new Error('Prompt too long even after reactive compaction');
          }
          state.hasReactiveCompacted = true;
          ctx.replace(reactiveCompact(ctx.messages));
          continue; // retry without backoff
        }
        if (isOverloadError(err)) {
          state.consecutiveOverload++;
          if (
            this.opts.fallbackModel &&
            state.consecutiveOverload >= this.opts.overloadThreshold
          ) {
            state.currentModel = this.opts.fallbackModel;
            params.model = state.currentModel;
          }
          if (attempt >= this.opts.maxRetries) {
            throw new Error(`LLM overloaded after ${attempt} retries: ${errMsg(err)}`);
          }
          await sleep(this.retryDelay(attempt));
          attempt++;
          continue;
        }
        throw err; // non-recoverable
      }
    }
  }

  /** Exponential backoff with jitter: min(base*2^a, max) + 0-25% jitter. */
  retryDelay(attempt: number): number {
    const base = Math.min(this.opts.baseDelayMs * 2 ** attempt, this.opts.maxDelayMs);
    const jitter = base * 0.25 * pseudoRandom();
    return Math.round(base + jitter);
  }
}

/** Detect overload / rate-limit errors across providers (status 429/529). */
export function isOverloadError(err: unknown): boolean {
  const status = errStatus(err);
  if (status === 429 || status === 529) return true;
  const msg = errMsg(err).toLowerCase();
  return msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('too many requests');
}

/** Detect context-length errors. */
export function isPromptTooLongError(err: unknown): boolean {
  const status = errStatus(err);
  if (status === 400) {
    const msg = errMsg(err).toLowerCase();
    if (msg.includes('prompt') && msg.includes('long')) return true;
    if (msg.includes('context length')) return true;
    if (msg.includes('maximum context')) return true;
  }
  const msg = errMsg(err).toLowerCase();
  return msg.includes('prompt_too_long') || msg.includes('context_length_exceeded');
}

function errStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; response?: { status?: unknown } };
    if (typeof e.status === 'number') return e.status;
    if (e.response && typeof e.response.status === 'number') return e.response.status;
  }
  return undefined;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Deterministic-enough pseudo-random in [0,1) without Math.random for testability. */
function pseudoRandom(): number {
  return (Date.now() % 1000) / 1000;
}
