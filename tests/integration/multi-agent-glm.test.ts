import { describe, it, expect } from 'vitest';
import { Agent, ManagerWorker, AllowAllResolver, PermissionManager, createBashTool } from '../../src/index.js';
import { glmClient, MODEL, runIntegration } from './helpers.js';

describe.skipIf(!runIntegration)('Manager-Worker + GLM (integration)', () => {
  it('manager delegates a computation to a worker', async () => {
    const worker = new Agent({
      name: 'math-worker',
      llm: glmClient(),
      model: MODEL,
      systemPrompt: 'You are a math worker. Use the bash tool to compute and return only the numeric answer.',
      tools: [createBashTool()],
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 5,
      maxTokens: 1024,
    });
    const manager = new Agent({
      name: 'manager',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You are a manager. Delegate computations to the "math-worker" via spawn_teammate, then report the result briefly.',
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 5,
      maxTokens: 1024,
    });
    const mw = new ManagerWorker({ manager, workers: [{ name: 'math-worker', agent: worker }] });
    const out = await mw.run('What is 17 * 23? Delegate to the math-worker.');
    expect(typeof out).toBe('string');
    expect(out).toMatch(/391/);
  }, 180_000);
});
