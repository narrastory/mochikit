import { describe, it, expect } from 'vitest';
import { InMemoryTaskStore } from '../../src/index.js';

describe('InMemoryTaskStore', () => {
  it('blocks a task until its dependency completes', async () => {
    const store = new InMemoryTaskStore();
    const a = await store.create({ subject: 'A', description: 'do A', blockedBy: [] });
    const b = await store.create({ subject: 'B', description: 'do B', blockedBy: [a.id] });

    expect(await store.canStart(a.id)).toBe(true);
    expect(await store.canStart(b.id)).toBe(false);

    await store.claim(a.id, 'worker1');
    const { unblocked } = await store.complete(a.id);
    expect(await store.canStart(b.id)).toBe(true);
    expect(unblocked.map((t) => t.id)).toContain(b.id);
  });

  it('claiming a blocked task throws', async () => {
    const store = new InMemoryTaskStore();
    const a = await store.create({ subject: 'A', description: '', blockedBy: [] });
    const b = await store.create({ subject: 'B', description: '', blockedBy: [a.id] });
    await expect(store.claim(b.id, 'w')).rejects.toThrow();
  });
});
