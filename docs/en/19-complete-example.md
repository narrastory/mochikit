# 17 - Complete Hands-on Example

In this chapter you will learn how to tie together everything from the preceding chapters to build an end-to-end practical example.

## Scenario

We want to build a "tech research assistant": the user provides a topic and the system automatically:

1. Uses Manager-Worker to decompose the task — one Worker searches for resources, another computes related data
2. The memory system records user preferences
3. A final chain step polishes the output into a report

## Full Code

```ts
import {
  Agent,
  AnthropicAdapter,
  loadConfig,
  ManagerWorker,
  SequentialChain,
  MarkdownMemory,
  InMemoryTaskStore,
  InMemoryMessageBus,
  createBashTool,
  createWebSearchTool,
  createWebReaderTool,
  createMemoryTools,
  createTaskTools,
  AllowAllResolver,
  PermissionManager,
  PluginBuilder,
  BaseTool,
  type ToolContext,
} from 'mochikit';

// =========== 1. Configuration ===========
const cfg = loadConfig();
const llm = () => new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
const perm = () => new PermissionManager({
  resolver: new AllowAllResolver(),
  rules: [{
    name: 'no-rm-rf',
    tools: ['bash'],
    check: (ctx) => (/rm\s+-rf/.test(String(ctx.tool.input.command)) ? 'ask' : 'passthrough'),
    reason: 'dangerous command',
  }],
});

// =========== 2. Memory System ===========
const memory = new MarkdownMemory({ dir: './.mochikit/examples/demo' });

// =========== 3. Custom Tool: Word Counter ===========
class WordCounterTool extends BaseTool {
  readonly definition = {
    name: 'word_count',
    description: 'Given a piece of text, count the number of characters.',
    input_schema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  };
  async execute(input: Record<string, unknown>): Promise<string> {
    const text = this.requireString(input, 'text');
    const count = text.replace(/\s+/g, '').length;
    return `Total characters: ${count}`;
  }
}

// =========== 4. Plugin: Research Toolkit ===========
const researchPlugin = new PluginBuilder('research-kit')
  .tool(new WordCounterTool())
  .tool(createWebSearchTool(cfg.webApiKey))
  .tool(createWebReaderTool(cfg.webApiKey))
  .hook('PostToolUse', (p) => {
    const payload = p as { tool: { name: string } };
    console.log(`[research] Tool ${payload.tool.name} finished executing`);
  })
  .build();

// =========== 5. Worker Agents ===========
const researcherWorker = new Agent({
  name: 'researcher',
  llm: llm(), model: cfg.model,
  systemPrompt: 'You are a researcher. Use web_search to search for content, use web_reader to read pages when necessary, and use word_count to count characters. Report key findings and character counts concisely.',
  permission: perm(), maxTurns: 6,
});
researcherWorker.use(researchPlugin);

const calculatorWorker = new Agent({
  name: 'calculator',
  llm: llm(), model: cfg.model,
  systemPrompt: 'You are a calculator. Use the bash tool for calculations. Return only the calculation result.',
  tools: [createBashTool()],
  permission: perm(), maxTurns: 4,
});

// =========== 6. Manager Agent ===========
const manager = new Agent({
  name: 'pm',
  llm: llm(), model: cfg.model,
  systemPrompt:
    'You are a project manager. Decompose the research task: have the researcher search and count, and have the calculator do data computations. Use spawn_teammate to delegate, then compile a report with project information. Use memory_write to save user preferences.',
  permission: perm(), memory,
  tools: createMemoryTools(memory),
  maxTurns: 8,
});

const mw = new ManagerWorker({
  manager,
  workers: [
    { name: 'researcher', agent: researcherWorker },
    { name: 'calculator', agent: calculatorWorker },
  ],
});

// =========== 7. Report Polishing Agent ===========
const polisher = new Agent({
  name: 'polisher',
  llm: llm(), model: cfg.model,
  systemPrompt: 'Polish the input text into a well-structured technical research report. Add a title and section headings.',
  permission: perm(), maxTurns: 3,
});

// =========== 8. Pipeline: Manager-Worker → Polish ===========
async function main() {
  // Record preferences first
  await memory.add({
    name: 'User Format Preference',
    type: 'feedback',
    description: 'Tech research report format preference',
    body: 'Report should be clearly structured: H1 title, H2 sections, each section with a bullet-point summary.',
  });

  // Manager-Worker research
  console.log('=== Starting Manager-Worker Research ===');
  const draft = await mw.run('Research "TypeScript decorators" and collect related statistics.');

  // Polish chain
  console.log('=== Polishing ===');
  const chain = new SequentialChain({ agents: [polisher], sharedMemory: memory });
  const final = await chain.run(draft);

  console.log('\n========== Final Report ==========\n');
  console.log(final);

  // Inspect saved memories
  const all = await memory.list();
  console.log(`\n${all.length} memories total`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

## What This Example Uses

| Feature | Location |
|---|---|
| `Agent` + `AnthropicAdapter` | Foundation |
| `createBashTool` / `createWebSearchTool` / `createWebReaderTool` | Built-in tools |
| `BaseTool` (`WordCounterTool`) | Custom tool |
| `PluginBuilder` / `agent.use()` | Plugin encapsulation |
| `MarkdownMemory` + `createMemoryTools` | Memory system |
| `PermissionManager` + rules | Permission control |
| `ManagerWorker` + `spawn_teammate` | Multi-agent delegation |
| `SequentialChain` | Sequential chain polishing |
| `Hook` (`PostToolUse`) | Audit hook |

## Running

```bash
npx tsx your-file.ts
```

The first run will make real calls to GLM (consuming tokens). For subsequent debugging, you can comment out the LLM calls and start with mocks.

---

*This is the final chapter of the MochiKit developer documentation. Happy building — go create interesting AI Agent applications!*
