/**
 * Example 05 — A custom plugin: bundles a tool, a hook, and a permission rule.
 * Run: npx tsx examples/05-custom-plugin.ts
 */
import {
  Agent,
  AnthropicAdapter,
  loadConfig,
  BaseTool,
  PluginBuilder,
  AllowAllResolver,
  PermissionManager,
} from '../src/index.js';

/** A toy tool that returns the current time. */
class CurrentTimeTool extends BaseTool {
  readonly definition = {
    name: 'current_time',
    description: 'Get the current ISO timestamp.',
    input_schema: { type: 'object', properties: {} },
  };
  async execute(): Promise<string> {
    return new Date().toISOString();
  }
}

// Build a plugin that wires in the tool + an audit hook + a permission rule.
const timePlugin = new PluginBuilder('time-plugin')
  .tool(new CurrentTimeTool())
  .hook('PostToolUse', (p) => {
    const payload = p as { tool: { name: string } };
    console.log(`[audit] tool ${payload.tool.name} executed`);
  })
  .rule({
    name: 'allow-time-only-bash',
    tools: ['bash'],
    check: () => 'ask' as const,
    reason: 'bash needs approval in this demo',
  })
  .build();

async function main() {
  const cfg = loadConfig();
  const agent = new Agent({
    name: 'plugin-demo',
    llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
    model: cfg.model,
    systemPrompt: 'You can tell the time using current_time. Be concise.',
    permission: new PermissionManager({ resolver: new AllowAllResolver() }),
    maxTurns: 4,
  });

  agent.use(timePlugin); // install the plugin

  const out = await agent.run('What time is it now? Use current_time.');
  console.log('\n--- Answer ---\n' + out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
