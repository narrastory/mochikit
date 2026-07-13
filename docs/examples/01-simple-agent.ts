/**
 * Example 01 — A single agent with filesystem + bash tools.
 * Run: npx tsx docs/examples/01-simple-agent.ts
 */
import {
  Agent,
  AnthropicAdapter,
  loadConfig,
  createBashTool,
  createFsTools,
  AllowAllResolver,
  PermissionManager,
} from '../src/index.js';

async function main() {
  const cfg = loadConfig();
  const agent = new Agent({
    name: 'demo',
    llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
    model: cfg.model,
    systemPrompt: 'You are a helpful coding assistant. Use tools when useful. Be concise.',
    tools: [createBashTool(), ...createFsTools()],
    permission: new PermissionManager({ resolver: new AllowAllResolver() }),
    maxTurns: 8,
  });

  const answer = await agent.run('List the TypeScript files under src/ and tell me how many there are.');
  console.log('\n--- Agent answer ---\n' + answer);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
