import { describe, it, expect } from 'vitest';
import { MicroCompaction, SnipCompaction, ToolResultBudget, reactiveCompact, defaultPipeline } from '../../src/index.js';
import type { Message } from '../../src/index.js';

function userWithResults(results: Array<[string, string]>): Message {
  return {
    role: 'user',
    content: results.map(([id, content]) => ({ type: 'tool_result', tool_use_id: id, content })),
  };
}

describe('Compaction', () => {
  it('MicroCompaction keeps only the last N tool results', () => {
    const msg = userWithResults([
      ['1', 'old1'],
      ['2', 'old2'],
      ['3', 'recent1'],
      ['4', 'recent2'],
    ]);
    const out = new MicroCompaction(2).compact([msg]);
    const results = (out[0].content as Array<{ type: string; content: string; tool_use_id: string }>).filter(
      (b) => b.type === 'tool_result',
    );
    expect(results[0].content).toContain('compacted');
    expect(results[2].content).toBe('recent1');
    expect(results[3].content).toBe('recent2');
  });

  it('ToolResultBudget truncates long results', () => {
    const long = 'x'.repeat(5000);
    const msg = userWithResults([['1', long]]);
    const out = new ToolResultBudget(100).compact([msg]);
    const r = (out[0].content as Array<{ type: string; content: string }>)[0];
    expect(r.content.length).toBeLessThan(long.length);
    expect(r.content).toContain('truncated');
  });

  it('SnipCompaction keeps head and tail', () => {
    const msgs: Message[] = Array.from({ length: 10 }, (_, i) => ({
      role: 'user' as const,
      content: `m${i}`,
    }));
    const out = new SnipCompaction(3).compact(msgs);
    expect(out.length).toBeLessThan(msgs.length);
    expect(out[0].content).toBe('m0');
    expect(out[out.length - 1].content).toBe('m9');
  });

  it('reactiveCompact keeps last N', () => {
    const msgs: Message[] = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const out = reactiveCompact(msgs, 3);
    expect(out.length).toBe(4);
  });

  it('defaultPipeline composes layers', () => {
    const msg = userWithResults([['1', 'x'.repeat(5000)]]);
    const out = defaultPipeline().compact([msg]);
    expect(out).toBeDefined();
  });
});
