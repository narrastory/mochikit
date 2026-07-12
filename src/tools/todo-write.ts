/**
 * TodoWrite tool — lightweight in-conversation planning (tutorial s05).
 *
 * Lets the model plan before executing by maintaining a todo list in process
 * memory. Unlike TaskStore (which is a persistent DAG for multi-agent
 * coordination), todo_write is ephemeral and scoped to a single conversation.
 */

import { BaseTool } from '../core/tool.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

let currentTodos: TodoItem[] = [];
let roundsSinceTodo = 0;

export function getRoundsSinceTodo(): number {
  return roundsSinceTodo;
}

export function incrementRoundsSinceTodo(): void {
  roundsSinceTodo++;
}

export function resetRoundsSinceTodo(): void {
  roundsSinceTodo = 0;
}

export function getCurrentTodos(): TodoItem[] {
  return currentTodos;
}

/** Nag threshold: after this many consecutive turns without todo_write, a reminder is injected. */
export const TODO_NAG_THRESHOLD = 3;

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

export function createTodoWriteTool(): TodoWriteTool {
  return new TodoWriteTool();
}

/** Normalise todos from various formats the model might produce. */
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

function validateStatus(s: string): TodoItem['status'] {
  if (s === 'in_progress' || s === 'completed') return s;
  return 'pending';
}
