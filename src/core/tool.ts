/**
 * Tool contract — the unit of capability plugged into the engine
 * (inspired by tutorial s02's dispatch map, upgraded to a typed OOP shape).
 *
 * ## Architecture
 *
 * Every tool implements the {@link Tool} interface.  {@link BaseTool} is a
 * convenience abstract class that holds the definition and provides typed
 * input-accessor helpers ({@link BaseTool.requireString},
 * {@link BaseTool.optionalString}, {@link BaseTool.optionalNumber}) so that
 * tool authors don't need to hand-write `typeof` guards for every parameter.
 *
 * For one-off or inline tools, {@link toolFromFunction} wraps a plain async
 * function as a `Tool` without requiring a class.
 */

import type { ToolDefinition } from './types.js';
import type { Memory } from '../memory/memory.js';
import type { MessageBus } from '../infra/message-bus.js';
import type { TaskStore } from '../infra/task-store.js';

/**
 * Runtime context handed to every tool execution.
 *
 * This is the tool's window into the agent's state.  Tools use
 * {@link agentName} for logging, {@link cwd} for file operations,
 * and optional backends ({@link memory}, {@link bus}, {@link tasks})
 * when the agent is configured with them.
 */
export interface ToolContext {
  /** Name of the agent executing this tool. */
  agentName: string;
  /** Absolute working directory for file-based operations. */
  cwd: string;
  /** Memory backend, if attached to the agent. */
  memory?: Memory;
  /** Message bus for inter-agent communication (collaboration patterns). */
  bus?: MessageBus;
  /** Task store for DAG-based workflows. */
  tasks?: TaskStore;
  /** Arbitrary per-run metadata (e.g. spawn delegation hooks). */
  runtime?: Record<string, unknown>;
}

/**
 * A tool's execute signature.
 *
 * @param input - The tool arguments, deserialised from the model's JSON.
 * @param ctx - Runtime context providing agent metadata and backends.
 * @returns A string result that will be wrapped in a {@link ToolResultBlock}.
 */
export type ToolExecutor = (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;

/**
 * Contract every tool must satisfy.
 *
 * A `Tool` carries a {@link ToolDefinition} (sent to the model so it knows
 * when and how to call this tool) and an `execute` method that runs the
 * actual logic.  Optionally, `isConcurrencySafe` signals whether this tool
 * can run in parallel with others during batched dispatch.
 */
export interface Tool {
  /** JSON-Schema definition exposed to the LLM. */
  readonly definition: ToolDefinition;
  /**
   * Execute the tool with the given input and context.
   * @param input - Arguments from the model's ToolUseBlock.
   * @param ctx - Runtime context (agent name, cwd, memory, etc.).
   * @returns A string result fed back to the model.
   */
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
  /**
   * Whether this tool is safe to run concurrently with others (for batching).
   * Default implementations should return `false` unless the tool has no
   * shared mutable state or side-effect ordering requirements.
   */
  isConcurrencySafe?(): boolean;
}

/**
 * Convenience base class: holds the definition and provides input helpers.
 *
 * Extend this class instead of implementing {@link Tool} from scratch.
 * Subclasses must provide a `definition` and an `execute` method.  The
 * protected helpers — {@link requireString}, {@link optionalString}, and
 * {@link optionalNumber} — eliminate boilerplate `typeof` checks when
 * pulling typed values out of the raw `input` record.
 */
export abstract class BaseTool implements Tool {
  /** JSON-Schema definition exposed to the LLM. */
  abstract readonly definition: ToolDefinition;

  /**
   * Execute the tool.
   * @param input - Arguments from the model's ToolUseBlock.
   * @param ctx - Runtime context.
   * @returns A string result.
   */
  abstract execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;

  /**
   * Whether this tool is safe to run concurrently with others (for batching).
   * Defaults to `false` — override to `true` for stateless or read-only tools.
   */
  isConcurrencySafe(): boolean {
    return false;
  }

  /**
   * Typed accessor for a required string input field.
   *
   * Throws if the field is missing, not a string, or an empty string.
   * This centralises validation so tool authors don't need inline guards.
   *
   * @param input - Raw input record from the model.
   * @param key - Field name to extract.
   * @returns The non-empty string value.
   * @throws Error if the field is missing or not a non-empty string.
   */
  protected requireString(input: Record<string, unknown>, key: string): string {
    const v = input[key];
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`Tool "${this.definition.name}" requires string input "${key}"`);
    }
    return v;
  }

  /**
   * Typed accessor for an optional string input field.
   *
   * Returns `undefined` if the field is missing or not a string.
   *
   * @param input - Raw input record from the model.
   * @param key - Field name to extract.
   * @returns The string value, or `undefined`.
   */
  protected optionalString(input: Record<string, unknown>, key: string): string | undefined {
    const v = input[key];
    return typeof v === 'string' ? v : undefined;
  }

  /**
   * Typed accessor for an optional number input field.
   *
   * Returns `undefined` if the field is missing, not a number, or `NaN`/`Infinity`.
   *
   * @param input - Raw input record from the model.
   * @param key - Field name to extract.
   * @returns The finite number value, or `undefined`.
   */
  protected optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
    const v = input[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }
}

/**
 * Wrap a plain function as a {@link Tool}.
 *
 * Useful for one-off or inline tools where creating a full class is
 * unnecessary.  The returned object satisfies the {@link Tool} interface.
 *
 * @param definition - JSON-Schema definition for the tool.
 * @param executor - The async function to call on execution.
 * @param concurrencySafe - Whether this tool can run concurrently (default `false`).
 * @returns A {@link Tool} object delegating to the provided function.
 */
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
