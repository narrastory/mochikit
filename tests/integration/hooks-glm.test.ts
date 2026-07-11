import { describe, it, expect } from 'vitest';
import { Agent, AnthropicAdapter, createBashTool, AllowAllResolver, PermissionManager, loadConfig } from '../../src/index.js';
import { runIntegration } from './helpers.js';

const cfg = loadConfig();

describe.skipIf(!runIntegration)('Hooks + GLM (integration)', () => {
  it('PreToolUse and PostToolUse fire during a real run', async () => {
    const preToolNames: string[] = [];
    const postToolNames: string[] = [];

    const agent = new Agent({
      name: 'hooks-demo',
      llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
      model: cfg.model,
      systemPrompt: 'Use the bash tool to run `echo hello` and report the output. Be concise.',
      tools: [createBashTool()],
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 4,
      maxTokens: 1024,
    });

    agent.registerHook('PreToolUse', (p) => {
      const payload = p as { tool: { name: string } };
      preToolNames.push(payload.tool.name);
    });
    agent.registerHook('PostToolUse', (p) => {
      const payload = p as { tool: { name: string } };
      postToolNames.push(payload.tool.name);
    });

    const out = await agent.run('Use bash to run `echo hello` and tell me the output.');
    expect(preToolNames).toContain('bash');
    expect(postToolNames).toContain('bash');
    expect(out.toLowerCase()).toContain('hello');
  }, 120_000);
});
