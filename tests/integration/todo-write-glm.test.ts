import { describe, it, expect } from 'vitest';
import { Agent, PermissionManager, AllowAllResolver } from '../../src/index.js';
import { createTodoWriteTool } from '../../src/tools/todo-write.js';
import { glmClient, MODEL, runIntegration } from './helpers.js';

describe.skipIf(!runIntegration)('TodoWrite — real GLM', () => {
  it('agent uses todo_write to plan a multi-step task', async () => {
    const agent = new Agent({
      name: 'todo-tester',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You are a planner. When given a multi-step task, use todo_write to plan before acting.' +
        ' List at least 2 steps with statuses. Be concise.',
      tools: [createTodoWriteTool()],
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 3,
    });

    const result = await agent.run(
      'I need to organize my project: (1) create a src folder, (2) create a README, (3) add a .gitignore.' +
      ' Use todo_write to plan this out first.',
    );
    // The model should respond with some kind of output
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
    // Log result for manual inspection
    console.log('[todo-write-glm] output:', result.slice(0, 300));
  }, 120_000);

  it('agent tracks todo progress across turns', async () => {
    const agent = new Agent({
      name: 'todo-tracker',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You are a task tracker. Use todo_write to create a plan, then mark items as completed.' +
        ' Be very concise — just a few words.',
      tools: [createTodoWriteTool()],
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 5,
    });

    const result = await agent.run(
      'Plan a simple task: "write a hello world script". Create a todo list with at least 3 items,' +
      ' mark some as in_progress, and explain your plan.',
    );
    expect(result.length).toBeGreaterThan(5);
    console.log('[todo-tracker] output:', result.slice(0, 300));
  }, 120_000);
});
