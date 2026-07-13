/**
 * TodoWrite tool — lightweight in-conversation planning (tutorial s05).
 *
 * Lets the model plan before executing by maintaining a todo list in process
 * memory. Unlike TaskStore (which is a persistent DAG for multi-agent
 * coordination), todo_write is ephemeral and scoped to a single conversation.
 *
 * ## In-conversation planning
 *
 * The todo list lives entirely in process memory — no file writes, no
 * database, no cross-agent visibility.  Each call to `todo_write` replaces
 * the entire list (not incremental).  Items have a three-state lifecycle
 * defined by {@link TodoItem.status}:
 *
 * - `pending` — not yet started.
 * - `in_progress` — exactly one item should have this at a time.
 * - `completed` — done.
 *
 * ## Nag mechanism
 *
 * The module tracks `roundsSinceTodo` — the number of consecutive agent
 * turns without a `todo_write` call.  When it reaches
 * {@link TODO_NAG_THRESHOLD}, the system prompt injector can append a
 * reminder to use `todo_write`.  Any call to `todo_write` resets the
 * counter.
 */

import { BaseTool } from '../core/tool.js';

/**
 * A single item in the in-conversation todo list.
 *
 * Each item tracks a task description and its current lifecycle status.
 * Only one item should be `in_progress` at any time.
 */
export interface TodoItem {
  /** Human-readable task description. */
  content: string;
  /** Lifecycle status: pending, in_progress, or completed. */
  status: 'pending' | 'in_progress' | 'completed';
}

let currentTodos: TodoItem[] = [];
let roundsSinceTodo = 0;

/**
 * Get the number of consecutive agent turns since the last `todo_write`
 * call.  Used by the system-prompt injector to decide when to nag.
 *
 * @returns The current rounds-since-todo count.
 */
export function getRoundsSinceTodo(): number {
  return roundsSinceTodo;
}

/**
 * Increment the rounds-since-todo counter by one.
 *
 * Called by the agent loop after each turn that did not include a
 * `todo_write` tool invocation.
 */
export function incrementRoundsSinceTodo(): void {
  roundsSinceTodo++;
}

/**
 * Reset the rounds-since-todo counter to zero.
 *
 * Called automatically by {@link TodoWriteTool.execute} whenever the model
 * updates the todo list.
 */
export function resetRoundsSinceTodo(): void {
  roundsSinceTodo = 0;
}

/**
 * Get a snapshot of the current in-memory todo list.
 *
 * Used by the system-prompt injector to render the current task state
 * into the next prompt.
 *
 * @returns A shallow reference to the current todo array (callers should
 *   treat this as read-only).
 */
export function getCurrentTodos(): TodoItem[] {
  return currentTodos;
}

/** Nag threshold: after this many consecutive turns without todo_write, a reminder is injected. */
export const TODO_NAG_THRESHOLD = 3;

/**
 * Tool that replaces the in-conversation todo list and resets the nag
 * counter.
 *
 * The model is expected to send the **complete** list on every call, not
 * just a delta.  This simplifies reasoning: the tool does not need to
 * reconcile partial updates against the existing state.
 *
 * Input is normalised via {@link normalizeTodos} so that malformed inputs
 * from the model (JSON strings, missing fields) are handled gracefully.
 */
export class TodoWriteTool extends BaseTool {
  readonly definition = {
    name: 'todo_write',
    description:
      'Create and manage a task list for your current coding session.' +
      ' Use this to plan before executing complex multi-step tasks.' +
      ' Replace the entire list on each call (not incremental).',
    input_schema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Task description' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'Current task status',
              },
            },
            required: ['content', 'status'],
          },
          description: 'The full todo list (replaces previous list)',
        },
      },
      required: ['todos'],
    },
  };

  /**
   * Replace the in-memory todo list with the model-supplied list.
   *
   * The input is normalised through {@link normalizeTodos} to handle
   * alternative formats (plain arrays, JSON-encoded strings, missing
   * status fields).  After replacement, the nag counter is reset and
   * the formatted list is logged to the console.
   *
   * @param input - Raw input from the model.
   *   - `todos` (array, required) — The complete replacement todo list.
   *     Each element must have `content` (string) and `status`
   *     (`"pending"`, `"in_progress"`, or `"completed"`).
   * @returns A short confirmation string (e.g. `"Updated 4 tasks."`).
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    const raw = input.todos;
    const todos = normalizeTodos(raw);
    currentTodos = todos;
    resetRoundsSinceTodo();

    const lines = ['## Current Tasks'];
    const icon: Record<string, string> = {
      pending: ' ',
      in_progress: '▸',
      completed: '✓',
    };
    for (const t of currentTodos) {
      lines.push(`  [${icon[t.status] ?? ' '}] ${t.content}`);
    }
    console.log(lines.join('\n'));
    return `Updated ${currentTodos.length} tasks.`;
  }
}

/**
 * Factory that creates a new {@link TodoWriteTool} instance.
 *
 * No configuration is needed — the tool uses module-level mutable state
 * (`currentTodos`, `roundsSinceTodo`) that all instances share.
 *
 * @returns A new {@link TodoWriteTool}.
 */
export function createTodoWriteTool(): TodoWriteTool {
  return new TodoWriteTool();
}

/**
 * Normalise todos from various formats the model might produce.
 *
 * Handles three cases:
 * 1. A well-formed array of objects with `content` and `status` fields.
 * 2. A JSON-encoded string (parsed recursively).
 * 3. Any other type (returns an empty array, silently recovering from
 *    malformed model output).
 *
 * @param raw - The raw `todos` value from the model input.
 * @returns A normalised {@link TodoItem} array.
 */
function normalizeTodos(raw: unknown): TodoItem[] {
  if (Array.isArray(raw)) {
    return raw.map((item: Record<string, unknown>) => ({
      content: String(item.content ?? ''),
      status: validateStatus(String(item.status ?? 'pending')),
    }));
  }
  if (typeof raw === 'string') {
    try {
      return normalizeTodos(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Validate and normalise a status string.
 *
 * Only `"in_progress"` and `"completed"` pass through as-is; any other
 * value (including `"pending"`, `null`, or arbitrary strings) defaults
 * to `"pending"`.
 *
 * @param s - The raw status string from the model input.
 * @returns A valid {@link TodoItem.status} value.
 */
function validateStatus(s: string): TodoItem['status'] {
  if (s === 'in_progress' || s === 'completed') return s;
  return 'pending';
}
