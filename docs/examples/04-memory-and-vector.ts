/**
 * Example 04 — Memory + Vector store.
 * Shows the unified Memory abstraction (Markdown) and the VectorStore
 * abstraction (InMemoryVectorStore) side by side.
 * Run: npx tsx docs/examples/04-memory-and-vector.ts
 */
import { MarkdownMemory, InMemoryVectorStore } from '../src/index.js';

async function main() {
  // --- Markdown memory (persistent) ---
  const memory = new MarkdownMemory({ dir: './.mochikit/examples/memory' });
  const entry = await memory.add({
    name: 'Project uses Node 18',
    type: 'project',
    description: 'runtime version constraint',
    body: 'MochiKit targets Node >= 18 with ESM + TypeScript 5.5.',
  });
  console.log('Saved memory:', entry.id);

  const hits = await memory.query('node version');
  console.log('Recalled:', hits.map((h) => h.name));

  // --- In-memory vector store (cosine similarity) ---
  const store = new InMemoryVectorStore();
  await store.add([
    { id: 'doc1', vector: [0.9, 0.1, 0], metadata: { topic: 'agents' } },
    { id: 'doc2', vector: [0.1, 0.9, 0], metadata: { topic: 'memory' } },
  ]);
  const nearest = await store.query([0.85, 0.15, 0], 1);
  console.log('Nearest vector:', nearest[0]?.id, nearest[0]?.metadata);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
