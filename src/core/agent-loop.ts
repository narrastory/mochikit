/**
 * AgentLoop — the core inference loop (tutorial s01, integrated per s20).
 *
 *   while (turns < maxTurns):
 *     compact → assemble → withRetry(LLM) → dispatch tool_use → feed back results
 *
 * All cross-cutting concerns (hooks, permission, compaction, recovery) are
 * injected, never hard-wired.
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

export interface AgentLoopOptions {
  agentName: string;
  cwd: string;
  llm: LLMClient;
  model: string;
  ctx: ConversationContext;
  tools: ToolRegistry;
  hooks?: HookManager;
  permission?: PermissionManager;
  recovery?: Recovery;
  compaction?: CompactionPipeline;
  maxTurns?: number;
  maxTokens?: number;
  /** Token threshold above which LLM-summarised compaction would kick in (reserved). */
  tokenBudget?: number;
  /** Extra ToolContext fields (memory, bus, tasks, runtime). */
  toolContextExtras?: Partial<ToolContext>;
  /** Optional model to fall back to under sustained overload. */
  fallbackModel?: string;
  /** Dynamic system prompt sections (s10). Assembled each turn when provided. */
  systemSections?: PromptSection[];
  /** Background task manager for async command execution (s13). */
  backgroundTasks?: BackgroundTaskManager;
}

export class AgentLoop {
  private opts: AgentLoopOptions & {
    maxTurns: number;
    maxTokens: number;
    compaction: CompactionPipeline;
    recovery: Recovery;
  };

  constructor(opts: AgentLoopOptions) {
    // Pick fields explicitly so optional `undefined` values don't clobber defaults.
    this.opts = {
      ...opts,
      maxTurns: opts.maxTurns ?? 30,
      maxTokens: opts.maxTokens ?? 8192,
      compaction: opts.compaction ?? defaultPipeline(),
      recovery: opts.recovery ?? new RecoveryClass({ fallbackModel: opts.fallbackModel }),
    };
  }

  async run(input: string): Promise<string> {
    const { ctx, hooks, agentName, systemSections } = this.opts;

    // UserPromptSubmit hook
    let userInput = input;
    if (hooks) {
      const r = await hooks.trigger('UserPromptSubmit', { input, agentName });
      if (r.replaceInput !== undefined) userInput = r.replaceInput;
      if (r.stopLoop) return '';
    }

    ctx.append({ role: 'user', content: userInput });

    // Dynamic system prompt (s10) — cache and assemble each turn
    const promptCache = systemSections ? createPromptCache() : null;

    const state = createRecoveryState(this.opts.model);
    let turns = 0;
    let continuationAttempts = 0;

    while (turns < this.opts.maxTurns) {
      turns++;

      // --- Background task notification injection (s13) ---
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

      // 1. cheap compaction
      ctx.replace(this.opts.compaction.compact(ctx.messages));

      // --- Dynamic system prompt assembly (s10) ---
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

      // 2. call LLM with recovery
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

      // 3. max_tokens escalation
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
        break;
      }

      // 4. append assistant turn
      ctx.append({ role: 'assistant', content: response.content });

      // 5. terminal stop
      if (response.stop_reason !== 'tool_use') {
        if (hooks) await hooks.trigger('Stop', { input: '', agentName });
        return extractFinalText(response);
      }

      // 6. dispatch tool_use blocks
      const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      const results = await this.dispatchTools(toolUses);

      // Merge background task notifications with tool results (s13)
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

      if (results.length > 0) {
        ctx.append({ role: 'user', content: results });
      }
    }

    // exhausted turns — return whatever the last assistant said
    const last = ctx.lastAssistant();
    return last ? extractText(last.content) : '';
  }

  private async dispatchTools(blocks: ToolUseBlock[]): Promise<ToolResultBlock[]> {
    const results: ToolResultBlock[] = [];
    for (const block of blocks) {
      const result = await this.dispatchOne(block);
      results.push(result);
    }
    return results;
  }

  private async dispatchOne(block: ToolUseBlock): Promise<ToolResultBlock> {
    const { hooks, permission, agentName, backgroundTasks } = this.opts;
    const toolCtx: ToolContext = {
      agentName,
      cwd: this.opts.cwd,
      ...this.opts.toolContextExtras,
    };

    // todo_write tracking (s05)
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

    // Background task spawn (s13): if bash with run_in_background, spawn async
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

  private async postTool(block: ToolUseBlock, result: string, isError: boolean): Promise<void> {
    if (this.opts.hooks) {
      await this.opts.hooks.trigger('PostToolUse', { tool: block, result, isError, agentName: this.opts.agentName });
    }
  }
}

function toolResult(id: string, content: string, isError: boolean): ToolResultBlock {
  return isError ? { type: 'tool_result', tool_use_id: id, content, is_error: true } : { type: 'tool_result', tool_use_id: id, content };
}

function extractFinalText(response: LLMResponse): string {
  const text = response.content
    .filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return text;
}

/** Re-export for type-only consumers. */
export type { Message };
