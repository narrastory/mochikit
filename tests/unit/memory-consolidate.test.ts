import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MarkdownMemory } from '../../src/memory/markdown-memory.js';

describe('MarkdownMemory.consolidate', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `mochikit-mem-test-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns 0 when fewer than 2 entries', async () => {
    const mem = new MarkdownMemory({ dir: tmpDir });
    await mem.add({ name: 'only-entry', type: 'reference', description: 'd', body: 'b' });
    const removed = await mem.consolidate();
    expect(removed).toBe(0);
    expect((await mem.list())).toHaveLength(1);
  });

  it('merges entries with the same slugified name', async () => {
    const mem = new MarkdownMemory({ dir: tmpDir });
    await mem.add({ name: 'Same Name!', type: 'user', description: 'first', body: 'body1' });
    await mem.add({ name: 'Same Name', type: 'user', description: 'second', body: 'body2' });
    const removed = await mem.consolidate();
    expect(removed).toBe(1);
    const entries = await mem.list();
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toContain('body1');
    expect(entries[0].body).toContain('body2');
  });

  it('keeps entries with different names separate', async () => {
    const mem = new MarkdownMemory({ dir: tmpDir });
    await mem.add({ name: 'alpha', type: 'reference', description: 'd', body: 'a' });
    await mem.add({ name: 'beta', type: 'reference', description: 'd', body: 'b' });
    const removed = await mem.consolidate();
    expect(removed).toBe(0);
    expect((await mem.list())).toHaveLength(2);
  });
});
