# 05 - Vector Store

In this chapter you'll learn: how to perform semantic similarity search with vectors, and how to integrate real vector databases like Chroma or Pinecone.

## 1. When to Use Vectors

`Memory` (Chapter 4) keyword recall works well for simple cases. When you have a large volume of documents or knowledge snippets and need to recall by **semantic similarity**, use a **vector store**: convert each piece of text into a vector (embedding), then find the nearest neighbors by cosine similarity.

MochiKit provides a unified `VectorStore` interface with a built-in in-memory implementation: `InMemoryVectorStore`.

## 2. InMemoryVectorStore

```ts
import { InMemoryVectorStore } from 'mochikit';

const store = new InMemoryVectorStore();

// Add vectors (id + vector + metadata)
await store.add([
  { id: 'doc1', vector: [0.9, 0.1, 0], metadata: { topic: 'agents' } },
  { id: 'doc2', vector: [0.1, 0.9, 0], metadata: { topic: 'memory' } },
  { id: 'doc3', vector: [0.85, 0.15, 0], metadata: { topic: 'agents' } },
]);

// Query the top k most similar
const nearest = await store.query([0.9, 0.05, 0], 2);
console.log(nearest.map(n => n.id)); // ['doc1', 'doc3']

// Query with metadata filtering
const filtered = await store.query([0.9, 0.05, 0], 5, { topic: 'memory' });
console.log(filtered.map(n => n.id)); // ['doc2']

// Remove
await store.remove('doc1');
```

> Note: `InMemoryVectorStore` does not generate vectors (embeddings). You need to call an embedding API
> yourself to convert text into `number[]` before storing.

## 3. VectorStore Interface

Any vector database can plug in by implementing these three methods:

```ts
interface VectorStore {
  add(items: VectorItem[]): Promise<void>;
  query(vector: number[], k: number, filter?: Record<string, unknown>): Promise<VectorItem[]>;
  remove(id: string): Promise<void>;
}

interface VectorItem {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}
```

## 4. Integrating Chroma (Sample Contract)

Chroma is a popular open-source vector database. Implement a `ChromaVectorStore`:

```ts
import type { VectorStore, VectorItem } from 'mochikit';
// Assuming you've installed chromadb: npm install chromadb
// import { ChromaClient } from 'chromadb';

class ChromaVectorStore implements VectorStore {
  // private client; private collection;
  constructor(/* connection config */) { /* init client + collection */ }

  async add(items: VectorItem[]): Promise<void> {
    // this.collection.add({ ids: items.map(i=>i.id),
    //   embeddings: items.map(i=>i.vector), metadatas: items.map(i=>i.metadata) })
  }

  async query(vector: number[], k: number, filter?: Record<string, unknown>): Promise<VectorItem[]> {
    // const res = await this.collection.query({ queryEmbeddings: [vector], nResults: k, where: filter });
    // return res.ids[0].map((id, i) => ({ id, vector: [], metadata: res.metadatas[0][i] }))
    return [];
  }

  async remove(id: string): Promise<void> {
    // await this.collection.delete({ ids: [id] })
  }
}
```

## 5. Integrating Pinecone (Sample Contract)

```ts
import type { VectorStore, VectorItem } from 'mochikit';
// npm install @pinecone-database/pinecone

class PineconeVectorStore implements VectorStore {
  constructor(/* index config */) {}

  async add(items: VectorItem[]): Promise<void> {
    // await this.index.upsert(items.map(i => ({ id: i.id, values: i.vector, metadata: i.metadata })))
  }

  async query(vector: number[], k: number, filter?: Record<string, unknown>): Promise<VectorItem[]> {
    // const res = await this.index.query({ vector, topK: k, filter, includeMetadata: true });
    // return res.matches.map(m => ({ id: m.id, vector: m.values ?? [], metadata: m.metadata ?? {} }))
    return [];
  }

  async remove(id: string): Promise<void> {
    // await this.index.deleteOne(id)
  }
}
```

## 6. Using Vectors in an Agent

A vector store typically serves as a backend for a tool. Write a custom tool that lets the Agent perform retrieval:

```ts
import { BaseTool, type ToolContext } from 'mochikit';

class VectorSearchTool extends BaseTool {
  readonly definition = {
    name: 'knowledge_search',
    description: 'Semantically search the knowledge base for relevant snippets.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  };
  constructor(private store: VectorStore, private embed: (text: string) => Promise<number[]>) { super(); }

  async execute(input: Record<string, unknown>): Promise<string> {
    const q = this.requireString(input, 'query');
    const vec = await this.embed(q);
    const hits = await this.store.query(vec, 5);
    return hits.map(h => JSON.stringify(h.metadata)).join('\n');
  }
}
```

Next chapter: [07-Manager-Worker](07-manager-worker.md).
