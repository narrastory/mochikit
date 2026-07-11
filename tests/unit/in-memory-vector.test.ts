import { describe, it, expect } from 'vitest';
import { InMemoryVectorStore } from '../../src/index.js';

describe('InMemoryVectorStore', () => {
  it('adds, queries by cosine similarity, and removes', async () => {
    const store = new InMemoryVectorStore();
    await store.add([
      { id: 'a', vector: [1, 0, 0], metadata: { tag: 'x' } },
      { id: 'b', vector: [0, 1, 0], metadata: { tag: 'y' } },
      { id: 'c', vector: [0.9, 0.1, 0], metadata: { tag: 'x' } },
    ]);
    const hits = await store.query([1, 0, 0], 2);
    expect(hits[0].id).toBe('a');
    expect(hits[1].id).toBe('c');

    const filtered = await store.query([1, 0, 0], 5, { tag: 'y' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('b');

    await store.remove('a');
    expect((await store.query([1, 0, 0], 5)).find((i) => i.id === 'a')).toBeUndefined();
  });
});
