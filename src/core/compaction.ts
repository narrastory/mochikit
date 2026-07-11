/**
 * Layered context compaction (tutorial s08).
 *
 * Cheap, deterministic layers run first (0 API calls); an LLM-based summary
 * is the last resort and is invoked by the loop only when the token budget
 * is still exceeded. Each layer is a pure function over Message[].
 */

import type { ContentBlock, Message, ToolResultBlock } from './types.js';

export interface CompactionLayer {
  name: string;
  compact(messages: Message[]): Message[];
}

/**
 * Keep only the most recent N tool_result blocks; replace older ones with a
 * placeholder so the model knows a result existed but is truncated.
 */
export class MicroCompaction implements CompactionLayer {
  constructor(private keepRecent = 3) {}
  readonly name = 'micro';

  compact(messages: Message[]): Message[] {
    const results = collectToolResults(messages);
    const toTrim = results.slice(0, Math.max(0, results.length - this.keepRecent));
    const trimIds = new Set(toTrim.map((r) => r.tool_use_id));
    if (trimIds.size === 0) return messages;
    return messages.map((m) => mapToolResults(m, (r) =>
      trimIds.has(r.tool_use_id)
        ? { ...r, content: '[Earlier tool result compacted. Re-run the tool if needed.]' }
        : r,
    ));
  }
}

/**
 * Trim the middle of the conversation: keep the first user turn and the last
 * `keepTail` messages, drop / summarize the rest into a single note.
 */
export class SnipCompaction implements CompactionLayer {
  constructor(private keepTail = 6) {}
  readonly name = 'snip';

  compact(messages: Message[]): Message[] {
    if (messages.length <= this.keepTail + 1) return messages;
    const head = messages[0];
    const tail = messages.slice(-this.keepTail);
    const dropped = messages.length - 1 - this.keepTail;
    const note: Message = {
      role: 'user',
      content: `[Context snipped: ${dropped} earlier messages omitted to save space.]`,
    };
    return [head, note, ...tail];
  }
}

/** Cap each tool_result's content to `maxChars`, appending an ellipsis. */
export class ToolResultBudget implements CompactionLayer {
  constructor(private maxChars = 4000) {}
  readonly name = 'budget';

  compact(messages: Message[]): Message[] {
    return messages.map((m) => mapToolResults(m, (r) =>
      r.content.length > this.maxChars
        ? { ...r, content: r.content.slice(0, this.maxChars) + '\n…[truncated]' }
        : r,
    ));
  }
}

/** Reactive emergency compaction: keep only the last N messages. */
export function reactiveCompact(messages: Message[], keepLast = 5): Message[] {
  if (messages.length <= keepLast) return messages;
  const tail = messages.slice(-keepLast);
  const note: Message = {
    role: 'user',
    content: `[Emergency compaction: ${messages.length - keepLast} earlier messages dropped.]`,
  };
  return [note, ...tail];
}

/** Run a sequence of layers in order. */
export class CompactionPipeline {
  constructor(private layers: CompactionLayer[]) {}

  compact(messages: Message[]): Message[] {
    return this.layers.reduce((msgs, layer) => layer.compact(msgs), messages);
  }
}

/** Default pipeline: budget → micro → snip (cheapest first). */
export function defaultPipeline(): CompactionPipeline {
  return new CompactionPipeline([
    new ToolResultBudget(),
    new MicroCompaction(),
    new SnipCompaction(),
  ]);
}

// --- helpers ---

function collectToolResults(messages: Message[]): ToolResultBlock[] {
  const out: ToolResultBlock[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content) if (b.type === 'tool_result') out.push(b);
  }
  return out;
}

function mapToolResults(m: Message, fn: (r: ToolResultBlock) => ToolResultBlock): Message {
  if (typeof m.content === 'string') return m;
  const mapped: ContentBlock[] = m.content.map((b) => (b.type === 'tool_result' ? fn(b) : b));
  return { ...m, content: mapped };
}
