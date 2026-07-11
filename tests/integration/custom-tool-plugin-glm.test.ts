import { describe, it, expect } from 'vitest';
import { Agent, AnthropicAdapter, BaseTool, PluginBuilder, AllowAllResolver, PermissionManager, loadConfig } from '../../src/index.js';
import { runIntegration } from './helpers.js';

const cfg = loadConfig();

/** A custom tool that returns a fixed secret number the model must surface. */
class SecretNumberTool extends BaseTool {
  readonly definition = {
    name: 'get_secret_number',
    description: 'Returns the current secret number.',
    input_schema: { type: 'object', properties: {} },
  };
  async execute(): Promise<string> {
    return 'The secret number is 4242.';
  }
}

describe.skipIf(!runIntegration)('Custom tool + plugin + GLM (integration)', () => {
  it('agent discovers and calls a plugin-provided custom tool', async () => {
    const agent = new Agent({
      name: 'custom-tool-demo',
      llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
      model: cfg.model,
      systemPrompt: 'You can call the get_secret_number tool. Answer the user using its result. Be concise.',
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 4,
      maxTokens: 1024,
    });

    const plugin = new PluginBuilder('secret-plugin').tool(new SecretNumberTool()).build();
    agent.use(plugin);

    const out = await agent.run('What is the secret number? Use the tool.');
    expect(typeof out).toBe('string');
    expect(out).toMatch(/4242/);
  }, 120_000);
});
