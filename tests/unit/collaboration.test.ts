import { describe, it, expect } from 'vitest';
import { Agent, SequentialChain, ManagerWorker } from '../../src/index.js';
import { MockLLMClient, textResponse, toolUseResponse } from '../helpers/mock-llm.js';

describe('SequentialChain', () => {
  it('pipes each agent output into the next', async () => {
    const a = new Agent({
      name: 'a',
      llm: new MockLLMClient([textResponse('A-out')]),
      model: 'm',
      systemPrompt: 's',
    });
    const b = new Agent({
      name: 'b',
      llm: new MockLLMClient([textResponse('B-out')]),
      model: 'm',
      systemPrompt: 's',
    });
    const chain = new SequentialChain({ agents: [a, b] });
    const out = await chain.run('start');
    expect(out).toBe('B-out');
    // agent b received a's output as input
    const bLlm = (b as unknown as { opts: { llm: MockLLMClient } }).opts.llm;
    expect(bLlm.calls[0].messages[0].content).toBe('A-out');
  });
});

describe('ManagerWorker', () => {
  it('manager delegates to a worker via spawn_teammate', async () => {
    const workerLlm = new MockLLMClient([textResponse('4')]);
    const worker = new Agent({ name: 'w1', llm: workerLlm, model: 'm', systemPrompt: 'worker' });

    const managerLlm = new MockLLMClient([
      toolUseResponse('t1', 'spawn_teammate', { worker: 'w1', task: 'compute 2+2' }),
      textResponse('The answer is 4'),
    ]);
    const manager = new Agent({ name: 'mgr', llm: managerLlm, model: 'm', systemPrompt: 'manager' });

    const mw = new ManagerWorker({ manager, workers: [{ name: 'w1', agent: worker }] });
    const out = await mw.run('what is 2+2?');
    expect(out).toBe('The answer is 4');
    // worker received the delegated task
    expect(workerLlm.calls[0].messages[0].content).toBe('compute 2+2');
    // manager's second call included the worker's result in tool_result
    const second = managerLlm.calls[1];
    const lastUser = second.messages[second.messages.length - 1];
    const result = (lastUser.content as Array<{ type: string; content?: string }>).find(
      (b) => b.type === 'tool_result',
    );
    expect(result?.content).toContain('4');
  });

  it('unknown worker yields an error result, not a crash', async () => {
    const managerLlm = new MockLLMClient([
      toolUseResponse('t1', 'spawn_teammate', { worker: 'ghost', task: 'x' }),
      textResponse('handled'),
    ]);
    const manager = new Agent({ name: 'mgr', llm: managerLlm, model: 'm', systemPrompt: 'manager' });
    const mw = new ManagerWorker({ manager, workers: [] });
    const out = await mw.run('go');
    expect(out).toBe('handled');
    const second = managerLlm.calls[1];
    const lastUser = second.messages[second.messages.length - 1];
    const result = (lastUser.content as Array<{ type: string; content?: string }>).find(
      (b) => b.type === 'tool_result',
    );
    expect(result?.content).toContain('unknown worker');
  });
});
