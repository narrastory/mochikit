import { describe, it, expect, beforeEach } from 'vitest';
import {
  TodoWriteTool,
  createTodoWriteTool,
  getRoundsSinceTodo,
  incrementRoundsSinceTodo,
  resetRoundsSinceTodo,
  getCurrentTodos,
  TODO_NAG_THRESHOLD,
} from '../../src/tools/todo-write.js';

describe('TodoWriteTool', () => {
  let tool: TodoWriteTool;

  beforeEach(() => {
    tool = createTodoWriteTool();
    resetRoundsSinceTodo();
  });

  it('has the correct definition', () => {
    expect(tool.definition.name).toBe('todo_write');
    expect(tool.definition.input_schema.required).toContain('todos');
  });

  it('parses and stores a valid todo list', async () => {
    const result = await tool.execute({
      todos: [
        { content: 'task A', status: 'pending' },
        { content: 'task B', status: 'in_progress' },
        { content: 'task C', status: 'completed' },
      ],
    });
    expect(result).toContain('3 tasks');
    const todos = getCurrentTodos();
    expect(todos).toHaveLength(3);
    expect(todos[0].content).toBe('task A');
    expect(todos[0].status).toBe('pending');
    expect(todos[1].status).toBe('in_progress');
    expect(todos[2].status).toBe('completed');
  });

  it('replaces todo list on subsequent calls', async () => {
    await tool.execute({ todos: [{ content: 'first', status: 'pending' }] });
    await tool.execute({ todos: [{ content: 'second', status: 'completed' }] });
    const todos = getCurrentTodos();
    expect(todos).toHaveLength(1);
    expect(todos[0].content).toBe('second');
  });

  it('resets roundsSinceTodo on write', async () => {
    incrementRoundsSinceTodo();
    incrementRoundsSinceTodo();
    await tool.execute({ todos: [{ content: 'x', status: 'pending' }] });
    expect(getRoundsSinceTodo()).toBe(0);
  });

  it('normalizes invalid status to pending', async () => {
    await tool.execute({ todos: [{ content: 'x', status: 'invalid' as 'pending' }] });
    expect(getCurrentTodos()[0].status).toBe('pending');
  });

  it('handles JSON string input', async () => {
    const result = await tool.execute({
      todos: JSON.stringify([{ content: 'json task', status: 'completed' }]),
    });
    expect(result).toContain('1 tasks');
    expect(getCurrentTodos()[0].content).toBe('json task');
  });

  it('handles empty todos', async () => {
    const result = await tool.execute({ todos: [] });
    expect(result).toContain('0 tasks');
    expect(getCurrentTodos()).toHaveLength(0);
  });
});

describe('nag counter', () => {
  beforeEach(() => {
    resetRoundsSinceTodo();
  });

  it('starts at 0', () => {
    expect(getRoundsSinceTodo()).toBe(0);
  });

  it('increments correctly', () => {
    incrementRoundsSinceTodo();
    incrementRoundsSinceTodo();
    expect(getRoundsSinceTodo()).toBe(2);
  });

  it('resets to 0', () => {
    incrementRoundsSinceTodo();
    resetRoundsSinceTodo();
    expect(getRoundsSinceTodo()).toBe(0);
  });

  it('nag threshold is 3', () => {
    expect(TODO_NAG_THRESHOLD).toBe(3);
  });
});

describe('createTodoWriteTool factory', () => {
  it('returns a TodoWriteTool instance', () => {
    const t = createTodoWriteTool();
    expect(t).toBeInstanceOf(TodoWriteTool);
  });
});
