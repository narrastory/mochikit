import { describe, it, expect } from 'vitest';
import { HookManager } from '../../src/index.js';

describe('HookManager', () => {
  it('runs hooks in priority order', async () => {
    const hm = new HookManager();
    const order: string[] = [];
    hm.on('UserPromptSubmit', () => { order.push('low'); }, 200);
    hm.on('UserPromptSubmit', () => { order.push('high'); }, 50);
    await hm.trigger('UserPromptSubmit', { input: 'x', agentName: 'a' });
    expect(order).toEqual(['high', 'low']);
  });

  it('PreToolUse can block by returning blockWith', async () => {
    const hm = new HookManager();
    hm.on('PreToolUse', () => ({ blockWith: 'blocked by hook' }));
    const r = await hm.trigger('PreToolUse', {
      tool: { type: 'tool_use', id: '1', name: 'bash', input: {} },
      agentName: 'a',
    });
    expect(r.blockWith).toBe('blocked by hook');
  });

  it('replaceInput folds from multiple hooks', async () => {
    const hm = new HookManager();
    hm.on('UserPromptSubmit', () => ({ replaceInput: 'A' }));
    hm.on('UserPromptSubmit', () => ({ replaceInput: 'B' }));
    const r = await hm.trigger('UserPromptSubmit', { input: 'x', agentName: 'a' });
    expect(r.replaceInput).toBe('B');
  });
});
