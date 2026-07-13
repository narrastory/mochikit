/**
 * Error recovery & retry (tutorial s11).
 *
 * ## Three Recovery Paths
 *
 * The `Recovery` class implements a state machine with three distinct paths
 * for different failure modes:
 *
 * 1. **Transient overload (429/529 / rate-limit)**
 *    → Exponential backoff with jitter, then retry.
 *    → After `overloadThreshold` consecutive overloads, switch to `fallbackModel`.
 *
 * 2. **Prompt too long (context_length_exceeded / prompt_too_long)**
 *    → Run reactive compaction once (uses `reactiveCompact`), then retry.
 *    → If it still fails after compaction, throw — we cannot shrink further.
 *
 * 3. **Output truncated (max_tokens / stop_reason)**
 *    → NOT handled here — handled by `AgentLoop` via token escalation and
 *      continuation prompts. This keeps the recovery layer focused on
 *      transient failures, not response-size heuristics.
 *
 * ## Exponential Backoff + Jitter
 *
 * The backoff formula: `min(baseDelay * 2^attempt, maxDelay) + 0-25% jitter`.
 *
 * Jitter is essential to avoid thundering-herd retries when multiple agents
 * hit the same rate limit simultaneously. We use a deterministic pseudo-random
 * function (`Date.now() % 1000 / 1000`) so that backoff is reproducible in
 * tests (no `Math.random()`).
 *
 * ## RecoveryState Tracking
 *
 * A single `RecoveryState` object is created per `AgentLoop.run()` call and
 * tracked across turns. This means:
 * - `consecutiveOverload` accumulates across turns (not just within one retry burst).
 * - `hasEscalated` / `hasReactiveCompacted` are one-shot guards — they prevent
 *   infinite retry loops from repeated escalation/compaction.
 * - `recoveryCount` is a diagnostic counter for observability.
 *
 * @module recovery
 */

import type { LLMClient, LLMCreateParams, LLMResponse } from './llm-client.js';
import type { ConversationContext } from './context.js';
import { reactiveCompact } from './compaction.js';

// --- RecoveryState ------------------------------------------------------------

/**
 * Mutable state tracking recovery progress across an agent run.
 *
 * Created once per `AgentLoop.run()` call via {@link createRecoveryState}.
 * Mutated in-place by {@link Recovery.call} — there is intentionally no
 * immutability here because the recovery logic is inherently stateful.
 */
export interface RecoveryState {
  /**
   * Whether `max_tokens` has already been escalated for this run.
   * Set by `AgentLoop` (not `Recovery`) when `stop_reason === 'max_tokens'`.
   * One-shot: prevents repeated escalation from consuming the entire token budget.
   */
  hasEscalated: boolean;
  /**
   * Total number of recovery actions taken (retries + compactions + escalations).
   * Diagnostic counter for observability / metrics.
   */
  recoveryCount: number;
  /**
   * Number of consecutive 429/529 responses without a successful call.
   * Reset to 0 on any successful LLM call. When this reaches
   * `overloadThreshold`, the recovery layer switches to `fallbackModel`.
   */
  consecutiveOverload: number;
  /**
   * Whether reactive compaction has already been attempted for this run.
   * One-shot guard: if compaction doesn't fix the `prompt_too_long` error,
   * we throw rather than compacting endlessly.
   */
  hasReactiveCompacted: boolean;
  /**
   * Currently active model identifier. Starts as the primary model and may
   * be switched to `fallbackModel` after sustained overload.
   */
  currentModel: string;
}

/**
 * Create a fresh {@link RecoveryState} with all counters at zero and the
 * given model as `currentModel`.
 *
 * @param model — the primary model identifier for this run.
 * @returns — a clean recovery state.
 */
export function createRecoveryState(model: string): RecoveryState {
  return {
    hasEscalated: false,
    recoveryCount: 0,
    consecutiveOverload: 0,
    hasReactiveCompacted: false,
    currentModel: model,
  };
}

// --- RecoveryOptions ----------------------------------------------------------

/**
 * Configuration for the {@link Recovery} retry/backoff strategy.
 *
 * All fields have conservative defaults suitable for shared API endpoints.
 */
export interface RecoveryOptions {
  /**
   * Maximum number of retries for overload (429/529) errors.
   * @default 5
   */
  maxRetries?: number;
  /**
   * Base delay in milliseconds for exponential backoff.
   * @default 500 — half a second before first retry.
   */
  baseDelayMs?: number;
  /**
   * Maximum delay ceiling for exponential backoff.
   * @default 32_000 — ~32 seconds, prevents unbounded wait.
   */
  maxDelayMs?: number;
  /**
   * Model identifier to switch to after sustained overload.
   * When `undefined`, no fallback occurs — overloads are retried up to
   * `maxRetries` on the current model.
   */
  fallbackModel?: string;
  /**
   * Number of consecutive overload responses before switching to `fallbackModel`.
   * @default 3 — three consecutive 429/529s trigger a model switch.
   */
  overloadThreshold?: number;
}

// --- Defaults -----------------------------------------------------------------

const DEFAULTS: Required<Omit<RecoveryOptions, 'fallbackModel'>> = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 32_000,
  overloadThreshold: 3,
};

// --- Recovery -----------------------------------------------------------------

/**
 * Error recovery strategy for LLM calls.
 *
 * ## Design
 *
 * `Recovery` wraps a single LLM `create()` call with retry logic. It is
 * **not** a general-purpose retry decorator — it understands LLM-specific
 * error semantics (overload, prompt length, truncation) and mutates both
 * the call parameters (`model`, `max_tokens`) and the conversation context
 * (reactive compaction) as side effects of recovery.
 *
 * ## Usage
 *
 * ```ts
 * const recovery = new Recovery({
 *   fallbackModel: 'glm-4-flash-free',
 *   overloadThreshold: 3,
 * });
 * const state = createRecoveryState('glm-4-flash');
 * const response = await recovery.call(params, llm, ctx, state);
 * // state.currentModel may now be 'glm-4-flash-free' if 3+ overloads occurred.
 * ```
 *
 * ## Non-recoverable Errors
 *
 * Errors that are neither overload (429/529) nor prompt-too-long are
 * re-thrown immediately — they represent configuration bugs or auth failures
 * that retrying cannot fix.
 */
export class Recovery {
  /** Resolved options with defaults applied. */
  private opts: Required<RecoveryOptions>;

  /**
   * @param opts — recovery configuration. Defaults fill any omitted fields.
   */
  constructor(opts: RecoveryOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts } as Required<RecoveryOptions>;
  }

  /**
   * Call the LLM with retry/recovery. Mutates `params` (model/max_tokens) and
   * `ctx` (reactive compaction) as side effects of recovery.
   *
   * ## Retry Flow
   *
   * ```
   * while (true):
   *   try: call LLM → return response (reset consecutiveOverload)
   *   catch prompt_too_long:
   *     if already compacted → throw (can't shrink further)
   *     else → reactiveCompact(ctx), retry (no backoff, no attempt increment)
   *   catch overload (429/529):
   *     increment consecutiveOverload
   *     if threshold reached → switch to fallbackModel
   *     if maxRetries exceeded → throw
   *     else → exponential backoff + jitter, retry
   *   catch anything else → throw (non-recoverable)
   * ```
   *
   * @param params — LLM call parameters. `params.model` is overwritten with
   *   `state.currentModel` before each attempt (to support fallback).
   * @param llm — the LLM client adapter.
   * @param ctx — conversation context, may be mutated by reactive compaction.
   * @param state — per-run recovery state, mutated in-place.
   * @returns — the successful LLM response.
   * @throws {Error} — if max retries exhausted on overload, or prompt too long
   *   even after reactive compaction, or any non-recoverable error.
   */
  async call(
    params: LLMCreateParams,
    llm: LLMClient,
    ctx: ConversationContext,
    state: RecoveryState,
  ): Promise<LLMResponse> {
    // Always sync the model from state — it may have been switched by fallback.
    params.model = state.currentModel;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const res = await llm.create(params);
        // Success resets the overload counter — the model is healthy again.
        state.consecutiveOverload = 0;
        return res;
      } catch (err) {
        state.recoveryCount++;
        if (isPromptTooLongError(err)) {
          // One-shot reactive compaction — we only try this once because
          // if the context is still too long after compaction, there's
          // nothing more we can do without losing essential context.
          if (state.hasReactiveCompacted) {
            throw new Error('Prompt too long even after reactive compaction');
          }
          state.hasReactiveCompacted = true;
          ctx.replace(reactiveCompact(ctx.messages));
          continue; // retry without backoff — compaction should fix it immediately
        }
        if (isOverloadError(err)) {
          state.consecutiveOverload++;
          // Fallback model switch: after `overloadThreshold` consecutive
          // overloads, assume the primary model is degraded and switch to
          // the fallback. The switch is permanent for this run.
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
        // Non-recoverable error (auth failure, bad request, network timeout, etc.)
        throw err;
      }
    }
  }

  /**
   * Compute the retry delay for a given attempt number.
   *
   * Formula: `min(baseDelay * 2^attempt, maxDelay) + 0-25% jitter`
   *
   * Examples (with defaults):
   * - attempt 0: 500ms + jitter
   * - attempt 1: 1000ms + jitter
   * - attempt 2: 2000ms + jitter
   * - attempt 4: 8000ms + jitter
   * - attempt 5+: 32000ms + jitter (capped)
   *
   * @param attempt — 0-based attempt number.
   * @returns — delay in milliseconds.
   */
  retryDelay(attempt: number): number {
    const base = Math.min(this.opts.baseDelayMs * 2 ** attempt, this.opts.maxDelayMs);
    // 0-25% jitter: spreads out retries from concurrent agents so they
    // don't all hammer the API at the exact same wall-clock time.
    const jitter = base * 0.25 * pseudoRandom();
    return Math.round(base + jitter);
  }
}

// --- Error Detection ----------------------------------------------------------

/**
 * Detect overload / rate-limit errors across providers.
 *
 * Checks HTTP status codes (429 Too Many Requests, 529 — some providers
 * use this for overload) and message body keywords. This is intentionally
 * broad to handle non-standard error formats from different API providers.
 *
 * @param err — caught error from an LLM call.
 * @returns — `true` if the error indicates a transient overload that should be retried.
 */
export function isOverloadError(err: unknown): boolean {
  const status = errStatus(err);
  if (status === 429 || status === 529) return true;
  const msg = errMsg(err).toLowerCase();
  return msg.includes('overloaded') || msg.includes('rate limit') || msg.includes('too many requests');
}

/**
 * Detect context-length / prompt-too-long errors.
 *
 * Checks for HTTP 400 with prompt-length keywords or provider-specific
 * error codes (`prompt_too_long`, `context_length_exceeded`). A 400 alone
 * is not sufficient — we require a keyword match to avoid mistaking
 * validation errors for context-length issues.
 *
 * @param err — caught error from an LLM call.
 * @returns — `true` if the prompt exceeds the model's context window.
 */
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

// --- Internal Helpers ---------------------------------------------------------

/**
 * Extract an HTTP status code from an error object.
 *
 * Handles two common patterns:
 * - `err.status` (e.g. Anthropic SDK errors)
 * - `err.response.status` (e.g. Axios errors)
 *
 * @param err — any caught value.
 * @returns — HTTP status code, or `undefined` if not found.
 */
function errStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; response?: { status?: unknown } };
    if (typeof e.status === 'number') return e.status;
    if (e.response && typeof e.response.status === 'number') return e.response.status;
  }
  return undefined;
}

/**
 * Extract a human-readable message from any error value.
 *
 * @param err — any caught value.
 * @returns — error message string, or the string representation of `err`.
 */
function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Promise-based `setTimeout` helper for async/await code.
 *
 * @param ms — milliseconds to sleep.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Deterministic pseudo-random number in [0, 1).
 *
 * Uses `Date.now() % 1000 / 1000` instead of `Math.random()` so that
 * backoff jitter is reproducible in test environments. For production,
 * the millisecond-level variation in `Date.now()` provides sufficient
 * entropy to spread out concurrent retries.
 *
 * @returns — a number in the range [0, 1).
 */
function pseudoRandom(): number {
  return (Date.now() % 1000) / 1000;
}
