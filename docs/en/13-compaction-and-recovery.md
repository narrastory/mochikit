# 12 - Context Compaction and Error Recovery

In this chapter you will learn: how to handle long conversations that blow up the context window, and how to handle API
errors — the framework has all of this built in; you just need to understand it and tune parameters as needed.

## 1. Context Compaction

As an agent runs, the conversation history grows longer and longer, eventually exceeding the model's context limit.
Before each turn, MochiKit automatically runs a **layered compaction pipeline** (from cheap to expensive):

1. `ToolResultBudget`: truncates overly long tool results (default 4000 characters).
2. `MicroCompaction`: keeps only the last 3 tool results; earlier ones are replaced with placeholder hints.
3. `SnipCompaction`: when the conversation is too long, keeps the first message + the most recent 6, collapsing the
   middle into a single hint.

These are all **zero-API-call** local operations. If still insufficient, the framework triggers reactive compaction
(see below).

You normally don't need to worry about this. If you need to customize:

```ts
import { Agent, CompactionPipeline, ToolResultBudget, MicroCompaction, SnipCompaction } from 'mochikit';

const myPipeline = new CompactionPipeline([
  new ToolResultBudget(8000),   // tool results capped at 8000 characters
  new MicroCompaction(5),       // keep the last 5 tool results
  new SnipCompaction(10),       // keep the first + most recent 10 messages
]);

const agent = new Agent({ /* ... */ compaction: myPipeline });
```

## 2. Error Recovery

Calling the LLM can encounter three categories of errors, handled automatically by the framework's `Recovery`:

| Error | Handling |
|---|---|
| 429 / 529 (rate limit / overload) | Exponential backoff retry (with jitter); continuous overload switches to `fallbackModel` |
| prompt too long (context overflow) | One-time reactive compaction (keeping only the last 5 messages), then retry |
| max_tokens (output truncated) | Auto-upgrade max_tokens and retry; append a "continue" prompt if necessary |

Default: 5 retries, base delay 500ms, max delay 32s.

Configuration:

```ts
import { Agent, Recovery } from 'mochikit';

const recovery = new Recovery({
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 32_000,
  fallbackModel: 'glm-4.7-mini', // optional: model to fall back to under overload
});

const agent = new Agent({
  // ...
  recovery,
  fallbackModel: 'glm-4.7-mini',
});
```

## 3. These Are Automatic

`Agent` comes with a default compaction pipeline and Recovery out of the box. **In most scenarios you don't need to
configure anything.** Only pass them explicitly when you need to tune parameters (longer history, different backoff,
fallback model).

## 4. Manual Compaction (Advanced)

If you manage message history externally, you can use the compaction functions directly:

```ts
import { reactiveCompact, defaultPipeline } from 'mochikit';

const pipeline = defaultPipeline();
const compacted = pipeline.compact(messages);   // run the full pipeline
const emergency = reactiveCompact(messages, 5); // emergency: keep only 5 messages
```

Next chapter: [14-Plugin System](14-plugin-system.md).
