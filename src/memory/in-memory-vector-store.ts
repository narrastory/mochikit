/**
 * InMemoryVectorStore — a test-friendly VectorStore using cosine similarity.
 */

import type { VectorItem, VectorStore } from './vector-store.js';

export class InMemoryVectorStore implements VectorStore {
  private items = new Map<string, VectorItem>();

  async add(items: VectorItem[]): Promise<void> {
    for (const it of items) this.items.set(it.id, it);
  }

  async query(vector: number[], k: number, filter?: Record<string, unknown>): Promise<VectorItem[]> {
    const candidates = filter
      ? [...this.items.values()].filter((it) => matchesFilter(it.metadata, filter))
      : [...this.items.values()];
    const scored = candidates.map((it) => ({ it, score: cosine(it.vector, vector) }));
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => s.it);
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function matchesFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (metadata[k] !== v) return false;
  }
  return true;
}
