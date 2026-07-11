import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MarkdownMemory } from '../../src/index.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mochikit-mem-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('MarkdownMemory', () => {
  it('adds, lists, and retrieves entries', async () => {
    const mem = new MarkdownMemory({ dir });
    const e = await mem.add({
      name: 'User prefers concise answers',
      type: 'feedback',
      description: 'keep it short',
      body: 'The user likes terse responses.',
    });
    expect(e.id).toBeTruthy();
    const list = await mem.list();
    expect(list).toHaveLength(1);
    const got = await mem.get(e.id);
    expect(got?.body).toContain('terse responses');
  });

  it('query matches by keyword', async () => {
    const mem = new MarkdownMemory({ dir });
    await mem.add({ name: 'Node version', type: 'project', description: 'uses node 18', body: 'The project runs on Node 18.' });
    await mem.add({ name: 'Color palette', type: 'reference', description: 'brand colors', body: 'Primary blue, accent orange.' });
    const hits = await mem.query('node 18');
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('Node version');
  });

  it('writes a MEMORY.md index', async () => {
    const mem = new MarkdownMemory({ dir });
    await mem.add({ name: 'X', type: 'reference', description: 'desc', body: 'body' });
    const idx = await fs.readFile(path.join(dir, 'MEMORY.md'), 'utf8');
    expect(idx).toContain('MEMORY.md'.replace('.md', '') === '' ? '' : 'X');
    expect(idx).toContain('desc');
  });

  it('updates and removes', async () => {
    const mem = new MarkdownMemory({ dir });
    const e = await mem.add({ name: 'old', type: 'reference', description: 'd', body: 'b' });
    await mem.update(e.id, { body: 'new body' });
    expect((await mem.get(e.id))?.body).toBe('new body');
    await mem.remove(e.id);
    expect(await mem.get(e.id)).toBeNull();
  });
});
