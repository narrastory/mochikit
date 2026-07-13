/**
 * InMemoryVectorStore — a test-friendly VectorStore using cosine similarity.
 *
 * ## Design
 *
 * This is the simplest possible {@link VectorStore} implementation: all data
 * lives in a `Map<string, VectorItem>` in process memory.  Queries compute
 * cosine similarity against every stored vector — an O(n * d) scan where `n`
 * is the number of items and `d` is the vector dimension.
 *
 * ## Suitability
 *
 * - **Development / testing**: zero dependencies, instant setup, deterministic.
 * - **Lightweight production**: acceptable up to a few thousand items with
 *   moderate vector dimensions (e.g. up to 1536).
 * - **Not suitable for**: production workloads with millions of vectors —
 *   use a dedicated vector database (Chroma, Pinecone) behind the same
 *   {@link VectorStore} interface for those cases.
 *
 * ## Usage
 *
 * ```ts
 * const store = new InMemoryVectorStore();
 * await store.add([{ id: "a", vector: [1, 0, 0], metadata: { type: "doc" } }]);
 * const hits = await store.query([1, 0, 0], 5, { type: "doc" });
 * ```
 */

import type { VectorItem, VectorStore } from './vector-store.js';

/**
 * In-process {@link VectorStore} backed by a `Map`.
 *
 * All operations are synchronous internally (promises resolve immediately).
 * The `clear()` method is a convenience for resetting state between tests.
 */
export class InMemoryVectorStore implements VectorStore {
  /** Internal storage: id → item. */
  private items = new Map<string, VectorItem>();

  /**
   * Insert or update items.  Existing items with the same `id` are overwritten.
   * @param items - The items to store.
   */
  async add(items: VectorItem[]): Promise<void> {
    for (const it of items) this.items.set(it.id, it);
  }

  /**
   * Return the top-`k` items ranked by cosine similarity to the query vector.
   *
   * When `filter` is provided, items whose metadata does not contain every
   * key-value pair in the filter are excluded from scoring.  Filter matching
   * uses strict equality (`===`) on each metadata value.
   *
   * @param vector - The query embedding.
   * @param k - Maximum number of results.
   * @param filter - Optional metadata equality filter.
   * @returns Top-`k` items sorted by descending cosine similarity.
   */
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

  /**
   * Remove an item by id.  Does nothing if the id is not present.
   * @param id - The item to remove.
   */
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }

  /**
   * Remove all stored items.  Useful for resetting state between tests
   * without constructing a new instance.
   */
  clear(): void {
    this.items.clear();
  }
}

/**
 * Compute cosine similarity between two vectors.
 *
 * Cosine similarity measures the cosine of the angle between two vectors:
 * `dot(a, b) / (|a| * |b|)`.  The result is in the range [-1, 1] where
 * 1 means identical direction (most similar), 0 means orthogonal, and -1
 * means opposite.
 *
 * Edge cases handled:
 * - If the vectors have different lengths → returns 0.
 * - If either vector has zero magnitude → returns 0 (avoids division by zero).
 * - If both vectors are empty → returns 0.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns Cosine similarity score in range [-1, 1].
 */
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

/**
 * Check whether every key-value pair in `filter` is present in `metadata`.
 *
 * Matching uses strict equality (`===`).  If `filter` is empty, this function
 * is not called — the caller short-circuits.
 *
 * @param metadata - The item's metadata bag.
 * @param filter - The query filter to match against.
 * @returns `true` if every key in `filter` has the same value in `metadata`.
 */
function matchesFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (metadata[k] !== v) return false;
  }
  return true;
}
