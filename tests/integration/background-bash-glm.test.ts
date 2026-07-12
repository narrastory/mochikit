import { describe, it, expect } from 'vitest';
import {
  Agent, PermissionManager, AllowAllResolver,
  BackgroundTaskManager, createBashTool,
} from '../../src/index.js';
import { glmClient, MODEL, runIntegration } from './helpers.js';

describe.skipIf(!runIntegration)('Background Bash — real GLM', () => {
  it('agent runs a background command and continues working', async () => {
    const bgMgr = new BackgroundTaskManager();
    const agent = new Agent({
      name: 'bg-bash',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You can run bash commands. For slow operations, set run_in_background: true.' +
        ' When you receive a background task notification, acknowledge it.' +
        ' Be concise — a single sentence is fine.',
      tools: [createBashTool()],
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      backgroundTasks: bgMgr,
      maxTurns: 4,
    });

    const result = await agent.run(
      'Run `echo "hello from background"` in the background (set run_in_background to true).',
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(5);
    console.log('[bg-bash] output:', result.slice(0, 300));
  }, 120_000);

  it('agent runs a quick sync bash command normally', async () => {
    const agent = new Agent({
      name: 'sync-bash',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'Use bash to run commands. Be concise — just state what you did.',
      tools: [createBashTool()],
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 2,
    });

    const result = await agent.run('Use bash to run: echo "quick sync test".');
    expect(result.length).toBeGreaterThan(5);
    expect(result.toLowerCase()).toContain('quick');
    console.log('[sync-bash] output:', result.slice(0, 200));
  }, 120_000);
});
