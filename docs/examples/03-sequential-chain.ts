/**
 * Example 03 — Sequential chain of agents.
 * Each stage's output feeds the next; a shared Memory carries context forward.
 * Run: npx tsx docs/examples/03-sequential-chain.ts
 */
import { Agent, AnthropicAdapter, loadConfig, SequentialChain, MarkdownMemory, createMemoryTools, AllowAllResolver, PermissionManager } from '../src/index.js';

async function main() {
  const cfg = loadConfig();
  const llm = new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  const memory = new MarkdownMemory({ dir: './.mochikit/examples/chain' });
  const perm = () => new PermissionManager({ resolver: new AllowAllResolver() });

  const drafter = new Agent({
    name: 'drafter',
    llm, model: cfg.model,
    systemPrompt: 'You draft a one-paragraph product description for a smart mug.',
    tools: createMemoryTools(memory), permission: perm(), maxTurns: 3,
  });
  const critic = new Agent({
    name: 'critic',
    llm, model: cfg.model,
    systemPrompt: 'You critique the text in one sentence and suggest the single most important improvement.',
    tools: createMemoryTools(memory), permission: perm(), maxTurns: 3,
  });
  const polisher = new Agent({
    name: 'polisher',
    llm, model: cfg.model,
    systemPrompt: 'You produce the final polished one-paragraph description, applying the critique.',
    tools: createMemoryTools(memory), permission: perm(), maxTurns: 3,
  });

  const chain = new SequentialChain({ agents: [drafter, critic, polisher], sharedMemory: memory });
  const out = await chain.run('Topic: a smart mug that keeps coffee at the perfect temperature.');
  console.log('\n--- Final copy ---\n' + out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
