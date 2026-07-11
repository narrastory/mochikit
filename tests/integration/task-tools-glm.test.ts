import { describe, it, expect } from 'vitest';
import { Agent, AnthropicAdapter, InMemoryTaskStore, createTaskTools, AllowAllResolver, PermissionManager, loadConfig } from '../../src/index.js';
import { runIntegration } from './helpers.js';

const cfg = loadConfig();

describe.skipIf(!runIntegration)('Task tools + GLM (integration)', () => {
  it('agent creates and completes a task via task tools', async () => {
    const tasks = new InMemoryTaskStore();
    const agent = new Agent({
      name: 'task-demo',
      llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
      model: cfg.model,
      systemPrompt:
        'You manage work with the task tools. Create a task for "summarise the weather", then complete it. ' +
        'Report the task ids. Be concise.',
      tools: createTaskTools(tasks),
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 6,
      maxTokens: 1024,
    });

    const out = await agent.run('Create a task "summarise the weather" and then mark it completed.');
    expect(typeof out).toBe('string');

    const list = await tasks.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    const completed = list.filter((t) => t.status === 'completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
