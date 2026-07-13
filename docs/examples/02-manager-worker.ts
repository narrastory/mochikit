/**
 * Example 02 — Manager-Worker collaboration.
 * The manager delegates subtasks to specialised workers via spawn_teammate.
 * Run: npx tsx docs/examples/02-manager-worker.ts
 */
import {
  Agent,
  AnthropicAdapter,
  loadConfig,
  ManagerWorker,
  createBashTool,
  AllowAllResolver,
  PermissionManager,
} from '../src/index.js';

async function main() {
  const cfg = loadConfig();
  const client = { llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }) };

  const researcher = new Agent({
    name: 'researcher',
    llm: client.llm,
    model: cfg.model,
    systemPrompt: 'You research facts. Answer concisely with the key finding only.',
    permission: new PermissionManager({ resolver: new AllowAllResolver() }),
    maxTurns: 4,
  });

  const calculator = new Agent({
    name: 'calculator',
    llm: client.llm,
    model: cfg.model,
    systemPrompt: 'You compute. Use the bash tool to run calculations and return only the number.',
    tools: [createBashTool()],
    permission: new PermissionManager({ resolver: new AllowAllResolver() }),
    maxTurns: 4,
  });

  const manager = new Agent({
    name: 'manager',
    llm: client.llm,
    model: cfg.model,
    systemPrompt:
      'You are a manager. Break the user request into subtasks and delegate to the ' +
      '"researcher" (for facts) or "calculator" (for math) via spawn_teammate. Summarise the results.',
    permission: new PermissionManager({ resolver: new AllowAllResolver() }),
    maxTurns: 6,
  });

  const mw = new ManagerWorker({ manager, workers: [
    { name: 'researcher', agent: researcher },
    { name: 'calculator', agent: calculator },
  ] });

  const out = await mw.run('How many seconds are in a day? Delegate the math to the calculator.');
  console.log('\n--- Manager result ---\n' + out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
