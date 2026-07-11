import { describe, it, expect } from 'vitest';
import { Agent, createBashTool, createFsTools, AllowAllResolver, PermissionManager } from '../../src/index.js';
import { glmClient, MODEL, runIntegration } from './helpers.js';

describe.skipIf(!runIntegration)('Agent + GLM (integration)', () => {
  it('uses the bash tool to answer a question', async () => {
    const agent = new Agent({
      name: 'mochikit-agent',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You are MochiKit test agent. Use tools when asked. Keep answers short.',
      tools: [createBashTool(), ...createFsTools()],
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 6,
      maxTokens: 2048,
    });
    const out = await agent.run(
      'Use the bash tool to run `echo 2 plus 2` and tell me the exact stdout.',
    );
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(out.toLowerCase()).toContain('2 plus 2');
  }, 120_000);
});
