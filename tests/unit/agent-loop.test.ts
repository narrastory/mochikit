import { describe, it, expect } from 'vitest';
import { Agent, ToolRegistry, toolFromFunction, ConversationContext } from '../../src/index.js';
import { MockLLMClient, textResponse, toolUseThenText } from '../helpers/mock-llm.js';

describe('AgentLoop', () => {
  it('runs a tool_use turn then terminates with end_turn', async () => {
    const llm = new MockLLMClient(toolUseThenText('t1', 'echo', { msg: 'hello' }, 'done'));
    const registry = new ToolRegistry();
    registry.register(
      toolFromFunction(
        { name: 'echo', description: 'echo', input_schema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] } },
        async (input) => `echoed: ${input.msg}`,
      ),
    );
    const agent = new Agent({
      name: 'a1',
      llm,
      model: 'm',
      systemPrompt: 'sys',
      tools: [],
    });
    // replace the agent's registry with our scripted one
    (agent as unknown as { registry: ToolRegistry }).registry = registry;

    const out = await agent.run('say hello');
    expect(out).toBe('done');
    // second LLM call should have received the tool_result in messages
    const second = llm.calls[1];
    const lastUser = second.messages[second.messages.length - 1];
    expect(Array.isArray(lastUser.content)).toBe(true);
    const resultBlock = (lastUser.content as Array<{ type: string; content?: string }>).find(
      (b) => b.type === 'tool_result',
    );
    expect(resultBlock?.content).toBe('echoed: hello');
  });

  it('respects maxTurns and returns last assistant text', async () => {
    // always request a tool, never end
    const llm = new MockLLMClient(
      Array.from({ length: 5 }, (_, i) => ({
        content: [{ type: 'tool_use', id: `t${i}`, name: 'echo', input: {} }],
        stop_reason: 'tool_use' as const,
      })),
    );
    const registry = new ToolRegistry();
    registry.register(
      toolFromFunction(
        { name: 'echo', description: 'echo', input_schema: { type: 'object', properties: {} } },
        async () => 'ok',
      ),
    );
    const agent = new Agent({ name: 'a', llm, model: 'm', systemPrompt: 's', maxTurns: 3 });
    (agent as unknown as { registry: ToolRegistry }).registry = registry;
    await agent.run('go');
    expect(llm.calls.length).toBe(3);
  });

  it('UserPromptSubmit hook can replace input', async () => {
    const llm = new MockLLMClient([textResponse('ok')]);
    const agent = new Agent({ name: 'a', llm, model: 'm', systemPrompt: 's' });
    agent.registerHook('UserPromptSubmit', (p) => ({
      replaceInput: (p as { input: string }).input.toUpperCase(),
    }));
    await agent.run('hello');
    expect(llm.calls[0].messages[0].content).toBe('HELLO');
  });

  it('ConversationContext estimates tokens > 0', () => {
    const ctx = new ConversationContext('system prompt');
    ctx.append({ role: 'user', content: 'a fairly long message with some words' });
    expect(ctx.estimateTokens()).toBeGreaterThan(0);
  });
});
