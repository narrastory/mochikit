/**
 * Lifecycle hook system — extension points that hang off the agent loop
 * without modifying the loop itself (inspired by tutorial s04).
 *
 * Hooks are async, ordered, and may short-circuit execution.
 */

import type { Message, ToolUseBlock } from './types.js';

export type HookEvent =
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop';

export interface PreToolUsePayload {
  tool: ToolUseBlock;
  agentName: string;
}

export interface PostToolUsePayload {
  tool: ToolUseBlock;
  result: string;
  isError: boolean;
  agentName: string;
}

export interface UserPromptSubmitPayload {
  input: string;
  agentName: string;
}

export type HookPayload = PreToolUsePayload | PostToolUsePayload | UserPromptSubmitPayload;

/** A hook may return a result that alters control flow, or void to continue. */
export interface HookResult {
  /** For PreToolUse: stop the tool from running and return this content as its result. */
  blockWith?: string;
  /** For UserPromptSubmit: replace the user input with this string. */
  replaceInput?: string;
  /** Stop the entire agent loop after this hook. */
  stopLoop?: boolean;
}

export type HookCallback<T extends HookPayload = HookPayload> = (payload: T) => Promise<HookResult | void> | HookResult | void;

interface RegisteredHook {
  event: HookEvent;
  callback: HookCallback;
  priority: number;
}

export class HookManager {
  private hooks: RegisteredHook[] = [];

  /** Register a hook. Lower priority runs first; default 100. */
  on<T extends HookPayload>(event: HookEvent, callback: HookCallback<T>, priority = 100): void {
    this.hooks.push({ event, callback: callback as HookCallback, priority });
    this.hooks.sort((a, b) => a.priority - b.priority);
  }

  /** Remove a previously registered hook callback. */
  off(event: HookEvent, callback: HookCallback): void {
    this.hooks = this.hooks.filter((h) => !(h.event === event && h.callback === callback));
  }

  /** Trigger all hooks for an event, folding their results. */
  async trigger<T extends HookPayload>(event: HookEvent, payload: T): Promise<HookResult> {
    const folded: HookResult = {};
    for (const h of this.hooks.filter((h) => h.event === event)) {
      const r = await h.callback(payload);
      if (!r) continue;
      if (r.blockWith !== undefined) folded.blockWith = r.blockWith;
      if (r.replaceInput !== undefined) folded.replaceInput = r.replaceInput;
      if (r.stopLoop) folded.stopLoop = true;
      if (r.blockWith !== undefined) break; // short-circuit on block
    }
    return folded;
  }
}

/** Convenience: build a HookManager from a list of registrations. */
export function createHookManager(
  ...regs: Array<{ event: HookEvent; callback: HookCallback; priority?: number }>
): HookManager {
  const hm = new HookManager();
  for (const r of regs) hm.on(r.event, r.callback, r.priority);
  return hm;
}

/** Re-export for type-only consumers. */
export type { Message };
