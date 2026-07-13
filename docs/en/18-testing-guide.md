# 16 - Testing Guide

In this chapter you will learn how to write unit tests and integration tests for your Agent code.

## 1. Two Types of Tests

- **Unit tests**: Use a mock LLM (no network, no cost, fast) to verify your logic.
- **Integration tests**: Real calls to GLM to verify end-to-end integration.

## 2. Running Tests

```bash
npm run test:unit          # Unit tests (mock)
npm run test:integration   # Integration tests (real GLM, requires .env + toggle)
npm test                   # All
npm run typecheck          # Type checking
```

## 3. Mock LLMClient

The core technique: inject a fake LLM that returns your pre-scripted responses. This way tests have no network dependency.

```ts
import { Agent } from 'mochikit';

// A minimal mock: always returns the same text
const mockLlm = {
  async create() {
    return {
      content: [{ type: 'text', text: 'Hello' }],
      stop_reason: 'end_turn',
    };
  },
};

const agent = new Agent({
  name: 't',
  llm: mockLlm,
  model: 'm',
  systemPrompt: 's',
});

const out = await agent.run('hi');
console.log(out); // 'Hello'
```

## 4. Scripting Multi-Turn Responses

A real Agent makes multiple turns (call tool first, then answer). Use a scripted queue to mock this:

```ts
class MockLLM {
  private queue = [
    { content: [{ type: 'tool_use', id: 't1', name: 'echo', input: { msg: 'hi' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
  ];
  async create() { return this.queue.shift()!; }
}
```

The repo's `tests/helpers/mock-llm.ts` provides `MockLLMClient`, `textResponse`, `toolUseResponse`, and other utilities you can reuse directly.

## 5. Writing a Unit Test

```ts
import { describe, it, expect } from 'vitest';
import { Agent, toolFromFunction, ToolRegistry } from 'mochikit';
import { MockLLMClient, toolUseThenText } from '../tests/helpers/mock-llm.js';

describe('my agent', () => {
  it('calls echo then answers', async () => {
    const llm = new MockLLMClient(toolUseThenText('t1', 'echo', { msg: 'x' }, 'ok'));
    const reg = new ToolRegistry();
    reg.register(toolFromFunction(
      { name: 'echo', description: 'd', input_schema: { type: 'object', properties: {} } },
      async (i) => `echoed:${i.msg}`,
    ));
    const agent = new Agent({ name: 'a', llm, model: 'm', systemPrompt: 's' });
    (agent as unknown as { registry: ToolRegistry }).registry = reg;
    expect(await agent.run('go')).toBe('ok');
  });
});
```

## 6. Writing an Integration Test

```ts
import { describe, it, expect } from 'vitest';
import { Agent, AnthropicAdapter, loadConfig, createBashTool, AllowAllResolver, PermissionManager } from 'mochikit';

const cfg = loadConfig();

describe.skipIf(!cfg.runIntegration)('my integration', () => {
  it('agent uses bash', async () => {
    const agent = new Agent({
      name: 't', llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
      model: cfg.model, systemPrompt: 'use bash', tools: [createBashTool()],
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
    });
    const out = await agent.run('run `echo hi`');
    expect(out.toLowerCase()).toContain('hi');
  }, 120_000); // real LLM needs generous timeout
});
```

Key points:

- `describe.skipIf(!cfg.runIntegration)`: automatically skips when the toggle is off.
- Loose assertions: only check keywords/structure; don't pin down exact model wording.
- Give generous `timeout` (on the order of seconds).

## 7. Testing Memory / Vector / Task Components

These components don't depend on an LLM and can be tested directly with unit tests:

```ts
import { MarkdownMemory, InMemoryVectorStore, InMemoryTaskStore } from 'mochikit';

const mem = new MarkdownMemory({ dir: tmpDir });
await mem.add({ name: 'x', type: 'reference', description: 'd', body: 'b' });
expect((await mem.list()).length).toBe(1);
```

See `tests/unit/` and `tests/integration/` in the repo for full examples.

Next chapter: [19-Complete Example](19-complete-example.md).
