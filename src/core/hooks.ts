/**
 * Lifecycle hook system — extension points that hang off the agent loop
 * without modifying the loop itself (inspired by tutorial s04).
 *
 * Hooks are async, ordered, and may short-circuit execution.
 *
 * ## The four lifecycle events
 *
 * Hooks fire at specific points in the agent loop. Each event has a
 * distinct purpose and payload:
 *
 * | Event              | When it fires                          | Payload                 |
 * |--------------------|----------------------------------------|-------------------------|
 * | `UserPromptSubmit` | Before the user's input enters the LLM | `UserPromptSubmitPayload` |
 * | `PreToolUse`       | Before a tool is executed              | `PreToolUsePayload`     |
 * | `PostToolUse`      | After a tool returns its result        | `PostToolUsePayload`    |
 * | `Stop`             | When the agent loop is about to exit   | (no payload data)       |
 *
 * ## Priority ordering
 *
 * When multiple hooks are registered for the same event, they run in
 * order of ascending `priority` (lower number = higher priority = runs
 * first). The default priority is 100.
 *
 * ## Short-circuit behavior
 *
 * If any hook returns `HookResult.blockWith`, execution immediately
 * short-circuits: no further hooks for that event run, and the tool
 * (or the entire loop for `stopLoop`) is stopped.
 *
 * ## Why hooks instead of middleware?
 *
 * Middleware wraps the entire loop (e.g. Express/koa style), which makes
 * it hard to hook into specific lifecycle points. MochiKit's hooks fire
 * at precise moments, giving plugins fine-grained control without needing
 * to understand or modify the loop internals.
 */

import type { Message, ToolUseBlock } from './types.js';

/**
 * The four points in the agent loop where hooks can fire.
 *
 * - `UserPromptSubmit` — The user has submitted a prompt. Hooks can
 *   rewrite the input before it reaches the LLM (e.g. for content
 *   filtering, prefix injection, or prompt templating).
 * - `PreToolUse` — A tool is about to be executed. Hooks can inspect or
 *   block the tool call (e.g. for permission enforcement, input
 *   validation, or logging).
 * - `PostToolUse` — A tool has returned its result. Hooks can inspect
 *   or transform the result (e.g. for output filtering, result caching,
 *   or metrics collection).
 * - `Stop` — The agent loop is about to exit. Hooks can perform cleanup
 *   (e.g. flushing logs, saving state, sending notifications).
 */
export type HookEvent =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop';

/**
 * Payload delivered to `PreToolUse` hooks.
 *
 * Contains the full tool use block so hooks can inspect the tool name,
 * input arguments, and tool_use_id before execution.
 */
export interface PreToolUsePayload {
  /** The tool use block that is about to be executed. */
  tool: ToolUseBlock;
  /** Name of the agent executing the tool. */
  agentName: string;
}

/**
 * Payload delivered to `PostToolUse` hooks.
 *
 * Contains both the original tool call AND the result, so hooks can
 * correlate inputs and outputs (useful for logging, caching, or
 * result transformation).
 */
export interface PostToolUsePayload {
  /** The tool use block that was executed. */
  tool: ToolUseBlock;
  /** The tool's result as a string (success or error). */
  result: string;
  /** Whether the tool execution resulted in an error. */
  isError: boolean;
  /** Name of the agent that executed the tool. */
  agentName: string;
}

/**
 * Payload delivered to `UserPromptSubmit` hooks.
 *
 * Contains the raw user input before it is sent to the LLM.
 * Hooks can rewrite this input via `HookResult.replaceInput`.
 */
export interface UserPromptSubmitPayload {
  /** The raw user input string. */
  input: string;
  /** Name of the agent receiving the input. */
  agentName: string;
}

/**
 * Union of all hook payload types.
 *
 * Used for typing the `HookCallback` and `HookManager.trigger()` generics.
 */
export type HookPayload = PreToolUsePayload | PostToolUsePayload | UserPromptSubmitPayload;

/**
 * A hook may return a result that alters control flow, or void to continue.
 *
 * Each field is optional. If a hook returns `undefined` or `{}`, it is a
 * no-op — execution continues as if the hook didn't exist.
 *
 * ## Field behavior
 *
 * - `blockWith` — for `PreToolUse`: stops the tool from running and
 *   returns this string as the tool's result to the LLM. The LLM sees
 *   a `tool_result` with this content instead of the actual tool output.
 *   This is useful for "virtual" tools or testing without real execution.
 *   Setting this causes an immediate short-circuit: no further hooks run.
 *
 * - `replaceInput` — for `UserPromptSubmit`: replaces the user's input
 *   with this string before it enters the LLM. Multiple hooks can set
 *   this — the last one (by priority) wins because hooks fold
 *   left-to-right.
 *
 * - `stopLoop` — for any event: stops the entire agent loop after the
 *   current event completes. The agent's `run()` method returns as if
 *   the stop condition were met. Multiple hooks can set this — the first
 *   one (by priority) causes the stop, but all hooks still fire.
 */
export interface HookResult {
  /**
   * For PreToolUse: stop the tool from running and return this content
   * as its result.
   */
  blockWith?: string;
  /**
   * For UserPromptSubmit: replace the user input with this string.
   */
  replaceInput?: string;
  /**
   * Stop the entire agent loop after this hook.
   */
  stopLoop?: boolean;
}

/**
 * A hook callback function.
 *
 * Can be synchronous or async, and can return `HookResult`, `void`, or
 * `undefined`. Returning `void`/`undefined` means "no action" — the hook
 * is purely observational (e.g. logging).
 *
 * @param payload — The event-specific payload.
 * @returns Optionally, a `HookResult` to alter control flow, or void.
 */
export type HookCallback<T extends HookPayload = HookPayload> = (payload: T) => Promise<HookResult | void> | HookResult | void;

/**
 * Internal representation of a registered hook.
 *
 * Stores the event, callback, and priority so hooks can be sorted
 * before firing. Not exposed publicly — users register via
 * `HookManager.on()` which creates this internal record.
 */
interface RegisteredHook {
  /** Which lifecycle event this hook listens to. */
  event: HookEvent;
  /** The callback to invoke. */
  callback: HookCallback;
  /**
   * Execution priority. Lower numbers run first. Default 100.
   *
   * ## Why 100 as the default?
   *
   * 100 gives room both above and below for framework-level hooks
   * (e.g. a built-in logging hook at priority 0) and user-level hooks
   * (at priority 50-200). This mirrors common middleware priority
   * conventions where values 0-50 are reserved for system use.
   */
  priority: number;
}

/**
 * Manages the registration and triggering of lifecycle hooks.
 *
 * ## Usage
 *
 * ```ts
 * const hooks = new HookManager();
 *
 * // Observation-only hook (no result returned)
 * hooks.on('PostToolUse', (payload) => {
 *   console.log(`Tool ${payload.tool.name} completed`);
 * });
 *
 * // Blocking hook
 * hooks.on('PreToolUse', (payload) => {
 *   if (payload.tool.name === 'rm_rf') {
 *     return { blockWith: 'Blocked: dangerous tool' };
 *   }
 * });
 *
 * // Input rewriting hook
 * hooks.on('UserPromptSubmit', (payload) => {
 *   return { replaceInput: `[Agent: ${payload.agentName}] ${payload.input}` };
 * });
 * ```
 *
 * ## Short-circuit semantics
 *
 * When `trigger()` encounters a hook that returns `blockWith`, it
 * immediately stops iterating through remaining hooks. This ensures
 * that if a high-priority hook blocks a tool, lower-priority hooks
 * don't override that decision.
 */
export class HookManager {
  /** Sorted list of registered hooks (by priority, ascending). */
  private hooks: RegisteredHook[] = [];

  /**
   * Register a hook for a specific lifecycle event.
   *
   * Hooks are sorted by priority after registration. This means the
   * sorting cost is paid at registration time (O(n log n)) rather than
   * at trigger time (O(1) iteration), which is a good trade-off since
   * hooks are registered once but triggered many times.
   *
   * @param event — The lifecycle event to listen to.
   * @param callback — The callback function. Can be sync or async.
   * @param priority — Execution order. Lower numbers run first. Default 100.
   * @typeParam T — The expected payload type for this event. Narrowing
   *   this allows the callback to access event-specific fields without
   *   type assertions.
   */
  on<T extends HookPayload>(event: HookEvent, callback: HookCallback<T>, priority = 100): void {
    this.hooks.push({ event, callback: callback as HookCallback, priority });
    // NOTE: Re-sort on every registration. For a small number of hooks
    // (typical: < 20), this is negligible. If hook registration becomes
    // a bottleneck, switch to insertion-sort in the push.
    this.hooks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Remove a previously registered hook callback.
   *
   * Uses reference equality (`===`) to match the callback. This means
   * you must pass the same function reference that was used in `on()`.
   * Anonymous functions or arrow functions defined inline at
   * registration time cannot be removed — store a reference if you
   * need to remove them later.
   *
   * @param event — The lifecycle event the hook was registered for.
   * @param callback — The exact same function reference passed to
   *   `on()`.
   */
  off(event: HookEvent, callback: HookCallback): void {
    this.hooks = this.hooks.filter((h) => !(h.event === event && h.callback === callback));
  }

  /**
   * Trigger all hooks registered for a given event, folding their
   * results.
   *
   * Hooks are invoked in priority order (lowest number first). Results
   * are folded: later hooks can override earlier hooks' `replaceInput`
   * and `stopLoop` values, but `blockWith` short-circuits immediately.
   *
   * ## Folding semantics
   *
   * The fold is left-biased with overrides:
   * - `blockWith` — first hook to set it wins (short-circuits). This
   *   is because blocking is a security decision and shouldn't be
   *   overridable.
   * - `replaceInput` — last hook to set it wins. This allows a chain
   *   of transformations (e.g. hook A adds a prefix, hook B adds a
   *   suffix).
   * - `stopLoop` — any hook can request a stop; once set to `true`, it
   *   stays `true`.
   *
   * @param event — The lifecycle event to trigger.
   * @param payload — The event-specific payload to pass to each hook.
   * @returns A `HookResult` representing the folded results of all
   *   hooks. An empty object means no hooks took action.
   */
  async trigger<T extends HookPayload>(event: HookEvent, payload: T): Promise<HookResult> {
    const folded: HookResult = {};
    for (const h of this.hooks.filter((h) => h.event === event)) {
      const r = await h.callback(payload);
      if (!r) continue;
      if (r.blockWith !== undefined) {
        folded.blockWith = r.blockWith;
        // IMPORTANT: Short-circuit on block. Once a hook blocks the tool,
        // no further hooks should run — this is a security boundary.
        break;
      }
      if (r.replaceInput !== undefined) folded.replaceInput = r.replaceInput;
      if (r.stopLoop) folded.stopLoop = true;
    }
    return folded;
  }
}

/**
 * Convenience: build a `HookManager` from a list of registrations.
 *
 * This is useful for creating a fully-configured hook manager in a single
 * expression, without repeated `.on()` calls:
 *
 * ```ts
 * const hooks = createHookManager(
 *   { event: 'PreToolUse', callback: mySecurityHook, priority: 10 },
 *   { event: 'PostToolUse', callback: myLogger },
 * );
 * ```
 *
 * @param regs — Array of { event, callback, priority? } objects.
 * @returns A new `HookManager` with all registrations applied in order.
 */
export function createHookManager(
  ...regs: Array<{ event: HookEvent; callback: HookCallback; priority?: number }>
): HookManager {
  const hm = new HookManager();
  for (const r of regs) hm.on(r.event, r.callback, r.priority);
  return hm;
}

/** Re-export for type-only consumers. */
export type { Message };
