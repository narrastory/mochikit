/**
 * Tool contract — the unit of capability plugged into the engine
 * (inspired by tutorial s02's dispatch map, upgraded to a typed OOP shape).
 */

import type { ToolDefinition } from './types.js';
import type { Memory } from '../memory/memory.js';
import type { MessageBus } from '../infra/message-bus.js';
import type { TaskStore } from '../infra/task-store.js';

/** Runtime context handed to every tool execution. */
export interface ToolContext {
  agentName: string;
  cwd: string;
  memory?: Memory;
  bus?: MessageBus;
  tasks?: TaskStore;
  /** Arbitrary per-run metadata (e.g. spawn delegation hooks). */
  runtime?: Record<string, unknown>;
}

/** A tool's execute signature. */
export type ToolExecutor = (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;

export interface Tool {
  readonly definition: ToolDefinition;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
  /** Whether this tool is safe to run concurrently with others (for batching). */
  isConcurrencySafe?(): boolean;
}

/** Convenience base class: holds the definition and provides input helpers. */
export abstract class BaseTool implements Tool {
  abstract readonly definition: ToolDefinition;

  abstract execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;

  isConcurrencySafe(): boolean {
    return false;
  }

  /** Typed accessor for a required string input field. */
  protected requireString(input: Record<string, unknown>, key: string): string {
    const v = input[key];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`Tool "${this.definition.name}" requires string input "${key}"`);
    }
    return v;
  }

  /** Typed accessor for an optional string input field. */
  protected optionalString(input: Record<string, unknown>, key: string): string | undefined {
    const v = input[key];
    return typeof v === 'string' ? v : undefined;
  }

  /** Typed accessor for an optional number input field. */
  protected optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
    const v = input[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }
}

/** Wrap a plain function as a Tool. */
export function toolFromFunction(
  definition: ToolDefinition,
  executor: ToolExecutor,
  concurrencySafe = false,
): Tool {
  return {
    definition,
    execute: executor,
    isConcurrencySafe: () => concurrencySafe,
  };
}
