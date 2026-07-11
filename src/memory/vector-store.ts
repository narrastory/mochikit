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
 */

export interface VectorItem {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorStore {
  add(items: VectorItem[]): Promise<void>;
  query(vector: number[], k: number, filter?: Record<string, unknown>): Promise<VectorItem[]>;
  remove(id: string): Promise<void>;
}
