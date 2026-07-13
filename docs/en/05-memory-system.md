# 04 - Memory System

In this chapter you'll learn: how to make an Agent remember facts, recall them on demand, and retain information across sessions.

## 1. Why Memory

By default, an Agent only remembers the current conversation history (and forgets everything after `reset()`). If you want your Agent to "remember user preferences," "remember project constraints," or "remember past feedback," you need a **memory system**.

MochiKit provides a unified `Memory` interface with a built-in Markdown-file-based implementation: `MarkdownMemory`.

## 2. Creating a MarkdownMemory

```ts
import { MarkdownMemory } from 'mochikit';

const memory = new MarkdownMemory({
  dir: './.mochikit/memory', // Storage directory
});
```

Each memory entry is stored as a `.md` file (with YAML frontmatter), and a `MEMORY.md` index is maintained automatically.

## 3. Direct Memory Operations

```ts
// Write
const entry = await memory.add({
  name: 'Prefers concise answers',
  type: 'feedback',            // user | feedback | project | reference
  description: 'Keep answers short',
  body: 'The user likes concise, direct answers. Avoid long-winded responses.',
});
console.log(entry.id);        // Auto-generated id

// List
const all = await memory.list();

// Keyword-based recall
const hits = await memory.query('answer style');
console.log(hits.map(h => h.name));

// Read a single entry
const one = await memory.get(entry.id);

// Update
await memory.update(entry.id, { body: 'New content' });

// Remove
await memory.remove(entry.id);
```

Recommended memory types:

- `user` -- who the user is, their role, preferences
- `feedback` -- feedback or corrections the user has given
- `project` -- project-related constraints, goals
- `reference` -- pointers to external resources (links, docs)

## 4. Letting the Agent Read and Write Memory Autonomously

Connect `memory` to the Agent and install memory tools. The Agent can then decide on its own when to remember and when to look things up:

```ts
import { Agent, AnthropicAdapter, loadConfig, MarkdownMemory, createMemoryTools, AllowAllResolver, PermissionManager } from 'mochikit';

const cfg = loadConfig();
const memory = new MarkdownMemory({ dir: './.mochikit/memory' });

const agent = new Agent({
  name: 'mem-agent',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You can use memory_write to remember important facts, and memory_read to recall them.',
  memory,
  tools: createMemoryTools(memory),
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

// First turn: remember
await agent.run('Please remember: my favorite programming language is Rust.');

// Second turn: recall
console.log(await agent.run('What is my favorite programming language? Use memory_read to check.'));
// Expected: Rust
```

The model will call `memory_write` to store, then use `memory_read` to recall.

## 5. Custom Recall Logic

By default, `query` uses keyword matching. To use LLM-powered semantic recall, provide a `recall` function:

```ts
const memory = new MarkdownMemory({
  dir: './.mochikit/memory',
  recall: async (entries, needle, k) => {
    // You could call an LLM here to pick the top k most relevant entries
    // Simple demo: substring matching
    return entries
      .filter(e => `${e.name} ${e.body}`.includes(needle))
      .slice(0, k);
  },
});
```

## 6. Persistence

`MarkdownMemory` writes directly to disk. Memories survive process restarts. Add the storage directory to `.gitignore`.

## Automatic Memory Injection

Set `autoMemory: true` and every `agent.run()` will automatically query relevant memories and inject them into the conversation:

```ts
const agent = new Agent({
  // ...
  memory: new MarkdownMemory({ dir: './.mochikit/memory' }),
  autoMemory: true,
});
```

## Memory Consolidation & Deduplication

When memory files accumulate, call `consolidate()` to merge duplicate or similar entries:

```ts
const removed = await memory.consolidate();
console.log(`Consolidated ${removed} duplicate memories`);
```

It groups by name, keeps the newest entry per group, merges body content, and removes old duplicates.

Next chapter: [06-Vector Store](06-vector-store.md).
