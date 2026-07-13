/**
 * AgentLoop — the core inference loop (tutorial s01, integrated per s20).
 *
 * ## The Central Loop
 *
 * Every AI agent runs the same fundamental cycle:
 *
 * ```
 *   while (turns < maxTurns):
 *     1. compact (shrink context to stay within budget)
 *     2. assemble (dynamic system prompt, todo reminders, background-task notifications)
 *     3. call LLM (with recovery — retries, escalation, fallback model)
 *     4. append assistant turn to context
 *     5. dispatch tool_use blocks (hooks → permission → execute)
 *     6. feed tool results back as user content
 * ```
 *
 * ## Design Principles
 *
 * - **All cross-cutting concerns are injected**, never hard-wired.
 *   Compaction, recovery, hooks, and permissions come from the constructor;
 *   the loop itself is a pure orchestration layer.
 * - **The loop is stateless apart from the turn counter** — all mutable state
 *   lives in `ConversationContext`, `RecoveryState`, and the injected components.
 * - **maxTurns=30** is a safety cap: it prevents infinite loops from runaway
 *   tool-calling patterns while allowing multi-step agent workflows.
 *
 * ## Known Sharp Edges
 *
 * The `{...opts}` spread pattern in the constructor (line ~69) will overwrite
 * defaults with `undefined` if the caller omits an optional field — because
 * `{ maxTurns: undefined }` spread over `{ maxTurns: 30 }` produces `undefined`.
 * We fix this by placing explicit `??` defaults **after** the spread. When
 * adding new optional fields to `AgentLoopOptions`, always follow this pattern;
 * never rely on spread alone to provide defaults.
 *
 * @module agent-loop
 */

import type { ConversationContext } from './context.js';
import type { CompactionPipeline } from './compaction.js';
import { defaultPipeline } from './compaction.js';
import type { Recovery } from './recovery.js';
import { Recovery as RecoveryClass, createRecoveryState } from './recovery.js';
import type { HookManager } from './hooks.js';
import type { LLMClient } from './llm-client.js';
import type { PermissionManager } from './permission.js';
import type { ToolContext } from './tool.js';
import type { ToolRegistry } from './tool-registry.js';
import type { ContentBlock, LLMResponse, Message, ToolResultBlock, ToolUseBlock } from './types.js';
import { extractText } from './types.js';
import type { PromptSection } from './system-prompt.js';
import { createPromptCache } from './system-prompt.js';
import type { BackgroundTaskManager } from '../infra/background-tasks.js';
import {
  incrementRoundsSinceTodo,
  getRoundsSinceTodo,
  resetRoundsSinceTodo,
  TODO_NAG_THRESHOLD,
} from '../tools/todo-write.js';

// --- Options ------------------------------------------------------------------

/**
 * Configuration for a single {@link AgentLoop} run.
 *
 * All fields that mirror framework components (hooks, permission, recovery,
 * compaction) accept pre-built instances — this is the DI entry point.
 * If omitted, sensible defaults are applied by the constructor.
 */
export interface AgentLoopOptions {
  /** Human-readable name for this agent instance (used in hooks, logging, tool context). */
  agentName: string;
  /** Working directory to run tool commands from. */
  cwd: string;
  /** LLM client adapter (e.g. AnthropicAdapter pointed at GLM). */
  llm: LLMClient;
  /** Model identifier string (e.g. `"glm-4-flash"`). */
  model: string;
  /** Conversation context holding the message history and system prompt. */
  ctx: ConversationContext;
  /** Tool registry providing tool definitions and dispatch. */
  tools: ToolRegistry;
  /** Optional lifecycle hook manager (UserPromptSubmit, PreToolUse, PostToolUse, Stop). */
  hooks?: HookManager;
  /** Optional permission manager (deny → rule → ask pipeline). */
  permission?: PermissionManager;
  /** Optional recovery strategy for retry/backoff/fallback. */
  recovery?: Recovery;
  /** Optional compaction pipeline for context shrinking. */
  compaction?: CompactionPipeline;
  /**
   * Maximum number of loop iterations before giving up.
   * @default 30 — balances multi-step workflows against infinite-loop risk.
   */
  maxTurns?: number;
  /**
   * Maximum tokens requested from the LLM per call.
   * @default 8192 — generous enough for tool-heavy responses without hitting
   *   provider limits on the first call; escalated 4x on truncation.
   */
  maxTokens?: number;
  /** Token threshold above which LLM-summarised compaction would kick in (reserved). */
  tokenBudget?: number;
  /**
   * Extra fields spread into the {@link ToolContext} passed to every tool.
   * Typically carries `memory`, `bus`, `tasks`, and `runtime`.
   */
  toolContextExtras?: Partial<ToolContext>;
  /** Optional model to fall back to under sustained overload (429/529 storms). */
  fallbackModel?: string;
  /**
   * Dynamic system prompt sections (tutorial s10).
   * Assembled each turn from a cache keyed on environment state
   * (tools, workDir, hasMemory, hasSkills). When absent, the static
   * `ctx.system` is used for every turn.
   */
  systemSections?: PromptSection[];
  /** Background task manager for async command execution (tutorial s13). */
  backgroundTasks?: BackgroundTaskManager;
}

// --- AgentLoop ----------------------------------------------------------------

/**
 * The inference loop that drives every MochiKit agent.
 *
 * ## Role
 *
 * `AgentLoop` orchestrates one complete agent run: it takes a user input string,
 * enters the `while (turns < maxTurns)` cycle, and returns the final assistant
 * text. It is the **only** place where the LLM is called in the framework.
 *
 * ## Composition
 *
 * All behaviour outside the raw loop — compaction, recovery, hooks, permissions —
 * is delegated to injected components. The loop itself stays thin and testable.
 *
 * ## Lifecycle (per turn)
 *
 * 1. **Background-task injection** — completed async tasks are surfaced as
 *    `<task_notification>` blocks.
 * 2. **Compaction** — cheap budget/micro/snip compaction runs (0 API calls).
 * 3. **Dynamic system prompt assembly** (s10) — if `systemSections` is set,
 *    assemble a fresh system prompt each turn from cached sections.
 * 4. **Todo nag reminder** (s05) — inject a reminder every
 *    `TODO_NAG_THRESHOLD` rounds if `todo_write` hasn't been used.
 * 5. **LLM call with recovery** — delegates to `Recovery.call()` which handles
 *    retries, backoff, and fallback-model failover.
 * 6. **max_tokens escalation** — if the response was truncated, double
 *    `maxTokens` (up to 64k) once, then inject continuation prompts up to 3
 *    times.
 * 7. **Tool dispatch** — filter `tool_use` blocks, run hooks → permission →
 *    execute → collect results, feed them back as `user` content.
 *
 * The loop terminates when:
 * - The LLM returns a stop reason other than `tool_use` (typically `end_turn`).
 * - `maxTurns` is exhausted (returns the last assistant text).
 * - Continuation attempts are exhausted after repeated truncation.
 */
export class AgentLoop {
  /**
   * Resolved options with all defaults applied.
   *
   * Key: `maxTurns`, `maxTokens`, `compaction`, and `recovery` are always
   * non-optional here because the constructor fills defaults after the spread.
   */
  private opts: AgentLoopOptions & {
    maxTurns: number;
    maxTokens: number;
    compaction: CompactionPipeline;
    recovery: Recovery;
  };

  /**
   * @param opts — raw loop options. Optional fields receive defaults via
   *   explicit `??` after the spread (see module-level note about the
   *   spread-overwrite bug).
   */
  constructor(opts: AgentLoopOptions) {
    // Pick fields explicitly so optional `undefined` values don't clobber defaults.
    // IMPORTANT: { ...opts } spreads `undefined` for omitted fields, which would
    // overwrite any defaults placed before the spread. Always place `??` defaults
    // AFTER the spread, never before.
    this.opts = {
      ...opts,
      maxTurns: opts.maxTurns ?? 30,
      maxTokens: opts.maxTokens ?? 8192,
      compaction: opts.compaction ?? defaultPipeline(),
      recovery: opts.recovery ?? new RecoveryClass({ fallbackModel: opts.fallbackModel }),
    };
  }

  /**
   * Execute one complete agent run.
   *
   * This is the public entry point. It sets up the per-run state (turn counter,
   * recovery state, continuation tracker), triggers the `UserPromptSubmit` hook,
   * appends the user message, and enters the main loop.
   *
   * @param input — raw user input string (may be rewritten by `UserPromptSubmit` hook).
   * @returns — the final assistant text, or `''` if the run was stopped early.
   */
  async run(input: string): Promise<string> {
    const { ctx, hooks, agentName, systemSections } = this.opts;

    // UserPromptSubmit hook — allows plugins to rewrite or suppress input
    let userInput = input;
    if (hooks) {
      const r = await hooks.trigger('UserPromptSubmit', { input, agentName });
      if (r.replaceInput !== undefined) userInput = r.replaceInput;
      if (r.stopLoop) return '';
    }

    ctx.append({ role: 'user', content: userInput });

    // Dynamic system prompt (s10) — cache and assemble each turn.
    // The cache key is derived from environment state (tools, workDir, hasMemory,
    // hasSkills) so we only recompute when the environment changes.
    const promptCache = systemSections ? createPromptCache() : null;

    const state = createRecoveryState(this.opts.model);
    let turns = 0;
    // Track how many times we've asked the model to "continue" after truncation.
    // Capped at 3 to prevent infinite continuation loops on pathological output.
    let continuationAttempts = 0;

    while (turns < this.opts.maxTurns) {
      turns++;

      // --- Background task notification injection (s13) ---
      // Poll for completed background tasks and inject their results as
      // <task_notification> user messages so the agent knows they finished.
      const bgTasks = this.opts.backgroundTasks;
      if (bgTasks) {
        const completed = bgTasks.check();
        for (const t of completed) {
          const summary = t.output.slice(0, 200);
          const note =
            `<task_notification>\n` +
            `<task_id>${t.bgId}</task_id>\n` +
            `<status>${t.status}</status>\n` +
            `<command>${t.command}</command>\n` +
            `<summary>${summary}${t.output.length > 200 ? '…' : ''}</summary>\n` +
            `</task_notification>`;
          ctx.append({ role: 'user', content: note });
        }
      }

      // 1. cheap compaction — runs budget, micro, and snip layers.
      //    0 API calls; shrinks context deterministically.
      ctx.replace(this.opts.compaction.compact(ctx.messages));

      // --- Dynamic system prompt assembly (s10) ---
      // Only recomputed when the cache key changes (different tools / memory /
      // skills state). Otherwise reuses the cached string.
      const effectiveSystem = promptCache
        ? promptCache.get(
            {
              workDir: this.opts.cwd,
              tools: this.opts.tools.list().map((t) => t.definition.name),
              hasMemory: this.opts.toolContextExtras?.memory !== undefined,
              hasSkills: false,
            },
            systemSections!,
          )
        : ctx.system;

      // --- Todo nag reminder (s05) ---
      // If the agent hasn't used todo_write for TODO_NAG_THRESHOLD consecutive
      // rounds, inject a gentle reminder. This is a heuristic — we don't want
      // the agent to lose track of its task plan during long runs.
      incrementRoundsSinceTodo();
      if (getRoundsSinceTodo() >= TODO_NAG_THRESHOLD && ctx.messages.length > 0) {
        ctx.append({
          role: 'user',
          content:
            '<reminder>You haven\'t updated your todo list in a while. ' +
            'Consider using todo_write to track progress on your current task.</reminder>',
        });
        resetRoundsSinceTodo();
      }

      // 2. call LLM with recovery.
      //    Recovery handles retries, backoff, prompt-too-long compaction,
      //    and fallback-model failover automatically.
      const params = {
        model: state.currentModel,
        system: effectiveSystem,
        messages: ctx.messages,
        tools: this.opts.tools.definitions(),
        max_tokens: this.opts.maxTokens,
      };
      const response: LLMResponse = await this.opts.recovery.call(
        params,
        this.opts.llm,
        ctx,
        state,
      );

      // 3. max_tokens escalation — the LLM response was truncated.
      //    Two paths:
      //    a) First truncation: escalate maxTokens 4x (up to 64k), drop the
      //       truncated assistant message, and retry the SAME turn.
      //    b) Subsequent truncations: inject a "Continue..." prompt up to 3
      //       times, letting the model pick up where it left off.
      if (response.stop_reason === 'max_tokens') {
        if (!state.hasEscalated) {
          state.hasEscalated = true;
          this.opts.maxTokens = Math.min(this.opts.maxTokens * 4, 64_000);
          // drop the truncated assistant turn and retry
          if (ctx.messages[ctx.messages.length - 1]?.role === 'assistant') {
            ctx.messages.pop();
          }
          continue;
        }
        if (continuationAttempts < 3) {
          continuationAttempts++;
          ctx.append({ role: 'user', content: 'Continue from where you left off.' });
          continue;
        }
        // Exhausted continuation attempts — break out and return what we have.
        break;
      }

      // 4. append assistant turn
      ctx.append({ role: 'assistant', content: response.content });

      // 5. terminal stop — the model is done (not requesting tool calls).
      if (response.stop_reason !== 'tool_use') {
        if (hooks) await hooks.trigger('Stop', { input: '', agentName });
        return extractFinalText(response);
      }

      // 6. dispatch tool_use blocks.
      //    Each block goes through: PreToolUse hook → permission check →
      //    execute (synchronous or background) → PostToolUse hook.
      const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      const results = await this.dispatchTools(toolUses);

      // Merge background task notifications with tool results (s13).
      // We check again because an async task may have completed while we were
      // dispatching synchronous tools.
      if (bgTasks) {
        const bgComplete = bgTasks.check();
        for (const t of bgComplete) {
          results.push({
            type: 'tool_result',
            tool_use_id: t.toolUseId,
            content: `[Background task ${t.bgId} ${t.status}]\n${t.output.slice(0, 500)}`,
          });
        }
      }

      // Feed tool results back into the conversation as a user message.
      // This is the standard tool-use protocol: the model expects results
      // wrapped in `tool_result` blocks inside a `user` role message.
      if (results.length > 0) {
        ctx.append({ role: 'user', content: results });
      }
    }

    // exhausted turns — return whatever the last assistant said
    const last = ctx.lastAssistant();
    return last ? extractText(last.content) : '';
  }

  /**
   * Dispatch multiple tool-use blocks sequentially.
   *
   * Tools are dispatched one at a time (not in parallel) to preserve
   * deterministic ordering and avoid race conditions on shared state.
   *
   * @param blocks — tool-use blocks from the LLM response.
   * @returns — corresponding tool-result blocks for each use.
   */
  private async dispatchTools(blocks: ToolUseBlock[]): Promise<ToolResultBlock[]> {
    const results: ToolResultBlock[] = [];
    for (const block of blocks) {
      const result = await this.dispatchOne(block);
      results.push(result);
    }
    return results;
  }

  /**
   * Dispatch a single tool-use block through the full pipeline:
   *
   * 1. {@link PreToolUse} hook — can block the tool with a custom message.
   * 2. {@link PermissionManager} gate — can deny with a reason.
   * 3. Background-task spawn — if `bash` with `run_in_background`, spawn async.
   * 4. Synchronous execution — call `ToolRegistry.dispatch()`.
   * 5. {@link PostToolUse} hook — notified of the result for logging/auditing.
   *
   * @param block — a single tool-use block from the LLM response.
   * @returns — a tool-result block to feed back into the conversation.
   */
  private async dispatchOne(block: ToolUseBlock): Promise<ToolResultBlock> {
    const { hooks, permission, agentName, backgroundTasks } = this.opts;
    const toolCtx: ToolContext = {
      agentName,
      cwd: this.opts.cwd,
      ...this.opts.toolContextExtras,
    };

    // todo_write tracking (s05) — reset the nag counter whenever the agent
    // uses todo_write, even if the tool later fails or is blocked.
    if (block.name === 'todo_write') {
      resetRoundsSinceTodo();
    }

    // PreToolUse hook may block.
    if (hooks) {
      const r = await hooks.trigger('PreToolUse', { tool: block, agentName });
      if (r.blockWith !== undefined) {
        return toolResult(block.id, r.blockWith, false);
      }
      if (r.stopLoop) {
        return toolResult(block.id, 'Stopped by hook.', false);
      }
    }

    // Permission gate.
    if (permission) {
      const verdict = await permission.check({ agentName, tool: block });
      if (verdict.decision === 'deny') {
        const msg = `Permission denied: ${verdict.reason ?? 'no reason given'}`;
        await this.postTool(block, msg, true);
        return toolResult(block.id, msg, true);
      }
    }

    // Background task spawn (s13): if bash with run_in_background, spawn async.
    // The task result will be injected in a future turn via bgTasks.check().
    if (block.name === 'bash' && block.input.run_in_background && backgroundTasks) {
      const cmd = typeof block.input.command === 'string' ? block.input.command : 'unknown';
      const bgId = backgroundTasks.spawn(cmd, block.id, toolCtx.cwd);
      return toolResult(
        block.id,
        `[Background task ${bgId} started] Command: ${cmd}. Result will be available when complete.`,
        false,
      );
    }

    // Execute synchronously.
    let output: string;
    let isError = false;
    try {
      output = await this.opts.tools.dispatch(block, toolCtx);
    } catch (err) {
      isError = true;
      output = err instanceof Error ? err.message : String(err);
    }

    await this.postTool(block, output, isError);
    return toolResult(block.id, output, isError);
  }

  /**
   * Fire the {@link PostToolUse} hook if a hook manager is configured.
   *
   * @param block — the tool-use block that was executed.
   * @param result — output string from tool execution (or error message).
   * @param isError — whether the execution failed.
   */
  private async postTool(block: ToolUseBlock, result: string, isError: boolean): Promise<void> {
    if (this.opts.hooks) {
      await this.opts.hooks.trigger('PostToolUse', { tool: block, result, isError, agentName: this.opts.agentName });
    }
  }
}

// --- Helpers ------------------------------------------------------------------

/**
 * Build a tool-result content block.
 *
 * When `isError` is true, the `is_error` field is set so the LLM knows
 * the tool call failed — this helps it self-correct rather than retrying
 * the same broken call.
 *
 * @param id — the `tool_use_id` from the original tool-use block.
 * @param content — output string or error message.
 * @param isError — whether this result represents a failure.
 * @returns — a properly shaped {@link ToolResultBlock}.
 */
function toolResult(id: string, content: string, isError: boolean): ToolResultBlock {
  return isError ? { type: 'tool_result', tool_use_id: id, content, is_error: true } : { type: 'tool_result', tool_use_id: id, content };
}

/**
 * Extract the final text output from an LLM response.
 *
 * Collects all `text`-type blocks and joins them with newlines.
 * Tool-use blocks and other non-text content are ignored — this function
 * is only called when `stop_reason !== 'tool_use'`, so the response should
 * be primarily text.
 *
 * @param response — the final LLM response.
 * @returns — joined text content, or `''` if no text blocks exist.
 */
function extractFinalText(response: LLMResponse): string {
  const text = response.content
    .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return text;
}

/** Re-export for type-only consumers. */
export type { Message };
