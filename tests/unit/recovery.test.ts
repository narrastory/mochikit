import { describe, it, expect } from 'vitest';
import { Recovery, createRecoveryState, isOverloadError, isPromptTooLongError } from '../../src/index.js';
import { ConversationContext } from '../../src/index.js';
import { MockLLMClient, textResponse } from '../helpers/mock-llm.js';

describe('Recovery', () => {
  it('retries on overload then succeeds', async () => {
    let calls = 0;
    const llm = {
      async create() {
        calls++;
        if (calls < 3) {
          const e = new Error('overloaded');
          (e as Error & { status: number }).status = 529;
          throw e;
        }
        return textResponse('ok');
      },
    };
    const recovery = new Recovery({ baseDelayMs: 1, maxDelayMs: 2 });
    const ctx = new ConversationContext('s');
    const state = createRecoveryState('m');
    const params = { model: 'm', system: 's', messages: [], tools: [], max_tokens: 100 };
    const res = await recovery.call(params, llm, ctx, state);
    expect(res.content[0]).toMatchObject({ type: 'text', text: 'ok' });
    expect(calls).toBe(3);
    expect(state.consecutiveOverload).toBe(0);
  });

  it('reactive-compacts once on prompt_too_long then retries', async () => {
    let calls = 0;
    const llm = {
      async create() {
        calls++;
        if (calls === 1) {
          const e = new Error('prompt too long');
          (e as Error & { status: number }).status = 400;
          throw e;
        }
        return textResponse('ok');
      },
    };
    const recovery = new Recovery();
    const ctx = new ConversationContext('s');
    for (let i = 0; i < 20; i++) ctx.append({ role: 'user', content: `msg ${i}` });
    const before = ctx.messages.length;
    const state = createRecoveryState('m');
    await recovery.call({ model: 'm', system: 's', messages: ctx.messages, tools: [], max_tokens: 100 }, llm, ctx, state);
    expect(state.hasReactiveCompacted).toBe(true);
    expect(ctx.messages.length).toBeLessThan(before);
  });

  it('throws after exhausting retries on sustained overload', async () => {
    const llm = {
      async create() {
        const e = new Error('overloaded');
        (e as Error & { status: number }).status = 529;
        throw e;
      },
    };
    const recovery = new Recovery({ baseDelayMs: 1, maxDelayMs: 2, maxRetries: 2 });
    const ctx = new ConversationContext('s');
    await expect(
      recovery.call({ model: 'm', system: 's', messages: [], tools: [], max_tokens: 100 }, llm, ctx, createRecoveryState('m')),
    ).rejects.toThrow(/overloaded/);
  });

  it('classifies error types', () => {
    const overload = new Error('x');
    (overload as Error & { status: number }).status = 429;
    expect(isOverloadError(overload)).toBe(true);
    const tooLong = new Error('context_length_exceeded');
    (tooLong as Error & { status: number }).status = 400;
    expect(isPromptTooLongError(tooLong)).toBe(true);
  });

  it('MockLLMClient sanity (keeps the helper exercised)', async () => {
    const m = new MockLLMClient([textResponse('x')]);
    expect((await m.create({ model: 'm', system: 's', messages: [], tools: [], max_tokens: 1 })).content[0]).toMatchObject({ text: 'x' });
  });
});
