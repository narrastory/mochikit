/**
 * VectorStore — abstraction over a vector database (tutorial s09 / s19).
 *
 * MochiKit ships {@link InMemoryVectorStore} (cosine similarity) for tests and
 * lightweight usage. The interface is the extension contract for real backends:
 *
 *   - ChromaVectorStore: implement via Chroma's JS client
 *       collection.add({ ids, embeddings, metadatas })
 *       collection.query({ queryEmbeddings, nResults, where }) → map to VectorItem[]
 *       collection.delete({ ids })
 *
 *   - PineconeVectorStore: implement via @pinecone-database/pinecone
 *       index.upsert(records)   // records: { id, values, metadata }
 *       index.query({ vector, topK, filter }) → map matches to VectorItem[]
 *       index.deleteOne(id)
 *
 * These adapters are intentionally left as a documented contract (no hard
 * dependency) — implement `VectorStore` and pass an instance wherever a vector
 * backend is required.
 *
 * ## When to use
 *
 * {@link VectorStore} enables semantic (embedding-based) search for memory
 * recall.  The {@link Memory.query} method can be backed by a vector store
 * instead of the default keyword matching, enabling "concept-aware" retrieval
 * that works even when the query and stored text use different vocabulary.
 *
 * ## Extension pattern
 *
 * The interface deliberately exposes raw vectors rather than hiding embeddings
 * behind an abstraction.  Callers are responsible for generating embeddings
 * (via an external model or API) before calling `add` and `query`.  This keeps
 * the store backend-agnostic — it neither depends on nor restricts which
 * embedding model you use.
 */

/**
 * A single item in a vector store — an id, its embedding vector, and
 * arbitrary metadata used for filtering.
 *
 * The `vector` is the embedding representation of some text content.
 * The `metadata` bag supports equality-based filtering during `query()`.
 */
export interface VectorItem {
  /** Unique identifier for this item (typically matches a {@link MemoryEntry.id}). */
  id: string;
  /** The embedding vector (arbitrary dimension, caller-managed). */
  vector: number[];
  /** Key-value pairs for equality-based filtering during queries. */
  metadata: Record<string, unknown>;
}

/**
 * The vector store contract — every vector backend satisfies this interface.
 *
 * Implementations must be able to:
 * - **Add** items (`id` + `vector` + `metadata`)
 * - **Query** by vector similarity with optional metadata filter
 * - **Remove** items by id
 *
 * The interface is intentionally minimal so that it can be backed by anything
 * from an in-memory cosine-similarity engine ({@link InMemoryVectorStore}) to
 * a managed cloud vector database (Chroma, Pinecone, Weaviate, etc.).
 */
export interface VectorStore {
  /**
   * Insert or update one or more items.  If an item with the same `id`
   * already exists, its vector and metadata are replaced.
   *
   * @param items - The items to store.
   */
  add(items: VectorItem[]): Promise<void>;

  /**
   * Return the top-`k` items most similar to the query vector.
   *
   * When `filter` is provided, only items whose metadata matches every
   * key-value pair in the filter are considered.  Filter matching is
   * **equality-only** — range queries and other operators must be
   * implemented by the specific backend.
   *
   * @param vector - The query embedding vector.
   * @param k - Maximum number of results to return.
   * @param filter - Optional metadata filter (equality match on all keys).
   * @returns Top-`k` items sorted by descending similarity.
   */
  query(vector: number[], k: number, filter?: Record<string, unknown>): Promise<VectorItem[]>;

  /**
   * Delete an item by id.  Silently succeeds if the id does not exist.
   *
   * @param id - The item to remove.
   */
  remove(id: string): Promise<void>;
}
