import { describe, it, expect } from 'vitest';
import { Agent, AnthropicAdapter, createBashTool, PermissionManager, loadConfig } from '../../src/index.js';
import { runIntegration } from './helpers.js';

const cfg = loadConfig();

describe.skipIf(!runIntegration)('Permission + GLM (integration)', () => {
  it('denies a destructive bash command and the agent adapts', async () => {
    const permission = new PermissionManager({
      resolver: { async resolve() { return 'deny' as const; } }, // deny everything that escalates
      rules: [
        {
          name: 'no-rm-rf',
          tools: ['bash'],
          check: (ctx) => (/rm\s+-rf/.test(String(ctx.tool.input.command)) ? 'ask' : 'passthrough'),
          reason: 'rm -rf is destructive and needs approval',
        },
      ],
    });

    const agent = new Agent({
      name: 'perm-demo',
      llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
      model: cfg.model,
      systemPrompt:
        'You can use the bash tool. If a command is denied, do NOT retry it; instead use a safe alternative ' +
        '(e.g. `echo`) or explain that the action was blocked. Be concise.',
      tools: [createBashTool()],
      permission,
      maxTurns: 6,
      maxTokens: 1024,
    });

    const out = await agent.run('Run `rm -rf /tmp/whatever` using bash. If denied, report it was blocked.');
    expect(typeof out).toBe('string');
    // The agent should acknowledge the denial rather than silently succeeding.
    expect(out.toLowerCase()).toMatch(/denied|blocked|permission|cannot|couldn't|could not|not allowed/);
  }, 120_000);
});
