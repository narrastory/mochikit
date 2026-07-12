import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/core/agent.js';
import { MockLLMClient, textResponse } from '../helpers/mock-llm.js';
import { PermissionManager, AllowAllResolver } from '../../src/core/permission.js';
import type { PromptSection } from '../../src/core/system-prompt.js';

describe('Agent with systemSections', () => {
  it('runs with dynamic system prompt sections', async () => {
    const llm = new MockLLMClient([textResponse('hello world')]);
    const sections: PromptSection[] = [
      { key: 'identity', content: 'You are a test agent.' },
      { key: 'workspace', content: 'Working directory: /test' },
    ];
    const agent = new Agent({
      name: 'test',
      llm,
      model: 'test-model',
      systemPrompt: 'fallback-static',
      systemSections: sections,
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
    });
    const result = await agent.run('hi');
    expect(result).toBe('hello world');
    // Verify LLM was called with the assembled sections
    expect(llm.calls.length).toBe(1);
    expect(llm.calls[0].system).toContain('You are a test agent.');
    expect(llm.calls[0].system).toContain('/test');
  });

  it('conditionally includes sections', async () => {
    const llm = new MockLLMClient([textResponse('ok')]);
    const sections: PromptSection[] = [
      { key: 'identity', content: 'Base prompt.' },
      {
        key: 'memory',
        content: 'Memory loaded.',
        condition: (ctx) => ctx.hasMemory,
      },
    ];
    const agent = new Agent({
      name: 'test',
      llm,
      model: 'test-model',
      systemPrompt: 'static',
      systemSections: sections,
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      // No memory → hasMemory will be false
    });
    await agent.run('hi');
    expect(llm.calls[0].system).toContain('Base prompt.');
    expect(llm.calls[0].system).not.toContain('Memory loaded.');
  });
});
