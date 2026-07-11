import { describe, it, expect } from 'vitest';
import { Agent, AnthropicAdapter, SequentialChain, AllowAllResolver, PermissionManager, loadConfig, type LLMClient, type LLMCreateParams, type LLMResponse } from '../../src/index.js';
import { runIntegration } from './helpers.js';

const cfg = loadConfig();

/** Wraps an LLMClient to count calls — proves the chain ran every stage. */
class CountingClient implements LLMClient {
  calls = 0;
  constructor(private inner: LLMClient) {}
  async create(params: LLMCreateParams): Promise<LLMResponse> {
    this.calls++;
    return this.inner.create(params);
  }
}

describe.skipIf(!runIntegration)('SequentialChain + GLM (integration)', () => {
  it('pipes three stages and produces a polished result', async () => {
    const counter = new CountingClient(new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }));
    const llm = counter;
    const perm = () => new PermissionManager({ resolver: new AllowAllResolver() });

    const drafter = new Agent({
      name: 'drafter', llm, model: cfg.model, maxTurns: 3, maxTokens: 1024,
      systemPrompt: 'Draft a one-paragraph product description for the given topic. Output only the paragraph.',
      permission: perm(),
    });
    const critic = new Agent({
      name: 'critic', llm, model: cfg.model, maxTurns: 3, maxTokens: 1024,
      systemPrompt: 'Critique the text in one sentence and state the single most important improvement.',
      permission: perm(),
    });
    const polisher = new Agent({
      name: 'polisher', llm, model: cfg.model, maxTurns: 3, maxTokens: 1024,
      systemPrompt: 'Produce the final polished one-paragraph description applying the critique. Output only the paragraph.',
      permission: perm(),
    });

    const chain = new SequentialChain({ agents: [drafter, critic, polisher] });
    const out = await chain.run('Topic: a smart mug that keeps coffee at the perfect temperature.');

    // Chain mechanics: all three stages ran (>= 3 LLM calls).
    expect(counter.calls).toBeGreaterThanOrEqual(3);
    // Produced a real paragraph.
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(40);
    expect(out).toMatch(/[.!?]/);
  }, 180_000);
});
