/**
 * Layered context compaction (tutorial s08).
 *
 * Compaction is the process of shrinking the conversation context so it stays
 * within the model's context window without discarding essential information.
 *
 * ## Three-layer pipeline (cheapest first, 0 API calls for all three)
 *
 * All compaction layers are deterministic, pure functions over `Message[]` —
 * they do not call the LLM and are therefore fast and predictable.
 *
 *   1. **ToolResultBudget** (cheapest) — caps each individual tool_result's
 *      content length to `maxChars`. Tool results (e.g. file reads, web
 *      fetches) can be enormous, so this runs first to cut the largest bloat
 *      without losing any message structure.
 *
 *   2. **MicroCompaction** (middle) — keeps only the most recent N tool_result
 *      blocks and replaces older ones with a placeholder. The model knows a
 *      result existed but sees a note instead of the full content. This
 *      preserves the message count while shrinking total token usage.
 *
 *   3. **SnipCompaction** (last resort among layers) — drops the oldest
 *      messages, keeping only the first user turn (for grounding) and the
 *      last N messages (for recent context). The middle is replaced by a
 *      single summary note. This is the most destructive layer because it
 *      loses message history, so it runs last.
 *
 * If these three layers still don't bring the context within budget, the
 * agent loop triggers `reactiveCompact()` — an emergency measure that drops
 * all but the last N messages.
 *
 * ## Why no LLM-based summarization in this file?
 *
 * LLM-based summarization is expensive (costs an API call, burns tokens) and
 * non-deterministic. The three layers here are sufficient for most cases.
 * If an LLM summary is truly needed, it can be implemented as an additional
 * `CompactionLayer` and prepended to the pipeline.
 *
 * Cheap, deterministic layers run first (0 API calls); an LLM-based summary
 * is the last resort and is invoked by the loop only when the token budget
 * is still exceeded. Each layer is a pure function over Message[].
 */

import type { ContentBlock, Message, ToolResultBlock } from './types.js';

/**
 * Contract for a single compaction strategy.
 *
 * Each layer is a pure function: given a list of messages, it returns a
 * (potentially shorter or summarized) list of messages. Layers are
 * intentionally stateless so they can be composed and reordered freely.
 */
export interface CompactionLayer {
  /** Human-readable name for debugging/logging (e.g. "budget", "micro", "snip"). */
  name: string;
  /**
   * Apply this compaction strategy to the given messages.
   *
   * @param messages — The full message history to compact.
   * @returns A new array of messages (the original is never mutated).
   */
  compact(messages: Message[]): Message[];
}

/**
 * Micro-compaction: keep only the most recent N tool_result blocks; replace
 * older ones with a placeholder so the model knows a result existed but is
 * truncated.
 *
 * This layer is the **second** in the default pipeline (after budget).
 * It preserves the full message structure (no messages are dropped) — only
 * the content of older tool results is replaced. This means the model still
 * sees the conversation flow but avoids token bloat from stale results.
 *
 * ## Why keepRecent defaults to 3?
 *
 * The most recent 3 tool results are typically sufficient for the model to
 * understand what just happened (e.g., "I read file X, then edited file Y,
 * and now need to check Z"). Older results are usually irrelevant after
 * their effects have been absorbed into later turns.
 */
export class MicroCompaction implements CompactionLayer {
  /**
   * @param keepRecent — Number of most recent tool_result blocks to preserve
   *   in full. Older results are replaced with a placeholder. Default 3.
   */
  constructor(private keepRecent = 3) {}
  readonly name = 'micro';

  /**
   * Compact messages by trimming older tool results.
   *
   * @param messages — The message history to compact.
   * @returns A new array with older tool_result content replaced by a
   *   placeholder string. Messages without tool_results are unchanged.
   */
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
 * Snip compaction: keep the first user turn and the last N messages, drop
 * everything in between into a single summary note.
 *
 * This is the **third and most aggressive** layer in the default pipeline.
 * Unlike MicroCompaction, which preserves message count, SnipCompaction
 * actually removes messages. This loses conversation history but is
 * sometimes the only way to fit within strict context windows.
 *
 * ## Why keep the first user turn?
 *
 * The first user message typically contains the overall task description and
 * grounding instructions. Without it, the model may drift from the original
 * goal after many turns of tool use.
 *
 * ## Why keepTail defaults to 6?
 *
 * 6 messages (roughly 3 user-assistant turn pairs) gives the model enough
 * recent context to continue meaningfully. Fewer than this and the model
 * may lose track of what it was doing.
 */
export class SnipCompaction implements CompactionLayer {
  /**
   * @param keepTail — Number of messages to keep from the end. Default 6.
   */
  constructor(private keepTail = 6) {}
  readonly name = 'snip';

  /**
   * Compact messages by snipping the middle of the conversation.
   *
   * @param messages — The message history to compact.
   * @returns A new array: `[firstMessage, summaryNote, ...tailMessages]`.
   *   If the message count is at or below `keepTail + 1`, returns unchanged.
   */
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

/**
 * Tool-result budget: cap each tool_result's content to `maxChars`,
 * appending an ellipsis.
 *
 * This layer is the **first** in the default pipeline because:
 * 1. It is the cheapest — O(n) char-length checks, no structural changes.
 * 2. Tool results (file reads, web page contents, command outputs) are the
 *    most common source of context bloat.
 * 3. By trimming giant tool results early, later layers have less data to
 *    process.
 *
 * ## Why maxChars defaults to 4000?
 *
 * 4000 characters is roughly 1000 tokens for English text — enough for the
 * model to understand the gist of a tool result without keeping the full
 * content. This threshold catches large file reads and web page dumps while
 * leaving smaller results intact.
 */
export class ToolResultBudget implements CompactionLayer {
  /**
   * @param maxChars — Maximum character length for any single tool_result
   *   content. Results exceeding this are truncated with an ellipsis.
   *   Default 4000.
   */
  constructor(private maxChars = 4000) {}
  readonly name = 'budget';

  /**
   * Compact messages by capping tool result content length.
   *
   * @param messages — The message history to compact.
   * @returns A new array with oversized tool_result content truncated.
   */
  compact(messages: Message[]): Message[] {
    return messages.map((m) => mapToolResults(m, (r) =>
      r.content.length > this.maxChars
        ? { ...r, content: r.content.slice(0, this.maxChars) + '\n…[truncated]' }
        : r,
    ));
  }
}

/**
 * Reactive (emergency) compaction: keep only the last N messages.
 *
 * This is NOT part of the normal pipeline — it is called by the agent loop
 * only when it receives a `prompt_too_long` error, indicating that even the
 * standard three-layer pipeline failed to shrink the context enough.
 *
 * ## Key difference from SnipCompaction
 *
 * SnipCompaction preserves the first user turn for grounding.
 * `reactiveCompact()` does NOT — it keeps only the tail because in an
 * emergency the priority is fitting the context window, not preserving
 * the original instructions. A note is prepended to tell the model what
 * happened.
 *
 * ## Why keepLast defaults to 5?
 *
 * 5 messages give the model the absolute minimum context to understand
 * where it was. This is intentionally aggressive — if the agent is in
 * emergency compaction, something has gone wrong with the context budget
 * and drastic measures are warranted.
 *
 * @param messages — The message history to compact.
 * @param keepLast — Number of messages to keep from the end. Default 5.
 * @returns A new array: `[emergencyNote, ...tailMessages]`.
 */
export function reactiveCompact(messages: Message[], keepLast = 5): Message[] {
  if (messages.length <= keepLast) return messages;
  const tail = messages.slice(-keepLast);
  const note: Message = {
    role: 'user',
    content: `[Emergency compaction: ${messages.length - keepLast} earlier messages dropped.]`,
  };
  return [note, ...tail];
}

/**
 * Run a sequence of compaction layers in order.
 *
 * Each layer receives the output of the previous layer. This is a classic
 * Chain of Responsibility / Pipeline pattern — each stage can independently
 * shrink the context, and the order matters because later stages see the
 * output of earlier ones.
 *
 * The pipeline is stateless: `compact()` can be called multiple times with
 * different inputs without side effects.
 */
export class CompactionPipeline {
  /**
   * @param layers — Ordered list of compaction layers. Layers run in array
   *   order, consuming the output of the previous layer.
   */
  constructor(private layers: CompactionLayer[]) {}

  /**
   * Run all layers sequentially over the messages.
   *
   * @param messages — The message history to compact.
   * @returns The messages after all layers have been applied, folded
   *   left-to-right.
   */
  compact(messages: Message[]): Message[] {
    return this.layers.reduce((msgs, layer) => layer.compact(msgs), messages);
  }
}

/**
 * Create the default compaction pipeline: budget → micro → snip.
 *
 * Layers are ordered from cheapest/least-destructive to most expensive/
 * most-destructive. Budget caps individual results first (no structural
 * change), then Micro trims old results (still no message loss), then
 * Snip drops entire messages as a last resort.
 *
 * @returns A `CompactionPipeline` pre-configured with `ToolResultBudget`,
 *   `MicroCompaction`, and `SnipCompaction` in the recommended order.
 */
export function defaultPipeline(): CompactionPipeline {
  return new CompactionPipeline([
    new ToolResultBudget(),
    new MicroCompaction(),
    new SnipCompaction(),
  ]);
}

// --- helpers ---

/**
 * Collect all `tool_result` blocks from an array of messages.
 *
 * Walks each message's content (which may be a string or `ContentBlock[]`)
 * and extracts every block with `type === 'tool_result'`. This is used by
 * `MicroCompaction` to identify which results to trim.
 *
 * @param messages — The messages to scan.
 * @returns A flat array of all tool_result blocks found.
 */
function collectToolResults(messages: Message[]): ToolResultBlock[] {
  const out: ToolResultBlock[] = [];
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content) if (b.type === 'tool_result') out.push(b);
  }
  return out;
}

/**
 * Apply a transformation function to every tool_result block within a single
 * message, leaving other block types unchanged.
 *
 * If the message's content is a plain string (user text), the message is
 * returned as-is — only compound message content is transformed.
 *
 * @param m — The message whose tool_result blocks should be mapped.
 * @param fn — A transformation function that receives a `ToolResultBlock`
 *   and returns a (possibly modified) `ToolResultBlock`.
 * @returns A new message with transformed content. The original is never
 *   mutated.
 */
function mapToolResults(m: Message, fn: (r: ToolResultBlock) => ToolResultBlock): Message {
  if (typeof m.content === 'string') return m;
  const mapped: ContentBlock[] = m.content.map((b) => (b.type === 'tool_result' ? fn(b) : b));
  return { ...m, content: mapped };
}
