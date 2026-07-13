/**
 * ConversationContext — the agent's mutable message history plus cheap
 * token-size estimation used by the compaction pipeline (tutorial s08).
 *
 * ## System prompt vs. messages
 *
 * The system prompt is stored separately from the {@link messages} array
 * because the Anthropic Messages API (and most LLM providers) pass it as a
 * top-level `system` parameter rather than as a message with `role: "system"`.
 * This separation lets the agent update the system prompt mid-conversation
 * (e.g. when tools or skills change) without mutating the message history.
 *
 * ## Managing the growing turn list
 *
 * Every assistant turn and its tool-result follow-ups append new entries to
 * {@link messages}.  Over long conversations this list can exceed the model's
 * context window.  {@link estimateTokens} provides a cheap (~4 chars/token)
 * heuristic that the compaction pipeline (`src/core/compaction.ts`) uses to
 * decide when to trim or summarise older turns.
 */

import type { ContentBlock, Message } from './types.js';
import { extractText } from './types.js';

/**
 * Mutable container for the agent's conversation state.
 *
 * Holds the system prompt separately from the message list (matching the
 * Anthropic Messages API shape) and provides a rough token estimator for
 * the compaction pipeline.
 */
export class ConversationContext {
  /** Ordered conversation messages (user, assistant, tool-results). */
  readonly messages: Message[] = [];
  private systemPrompt: string;

  /**
   * @param systemPrompt - The initial system prompt string.
   * @param initial - Optional seed messages (e.g. a conversation prefix).
   */
  constructor(systemPrompt: string, initial: Message[] = []) {
    this.systemPrompt = systemPrompt;
    this.messages.push(...initial);
  }

  /** The current system prompt string. */
  get system(): string {
    return this.systemPrompt;
  }

  /**
   * Replace the system prompt mid-conversation.
   *
   * Used when tools or skills change and the prompt needs to reflect the
   * new capabilities without rebuilding the message history.
   *
   * @param prompt - The new system prompt string.
   */
  setSystem(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * Append a message to the conversation history.
   *
   * @param message - The message to append.
   */
  append(message: Message): void {
    this.messages.push(message);
  }

  /**
   * Replace the entire message history (used by compaction layers).
   *
   * Clears the current list and seeds it with the provided messages.
   * This is destructive — the old history is discarded.
   *
   * @param messages - The new message list.
   */
  replace(messages: Message[]): void {
    this.messages.length = 0;
    this.messages.push(...messages);
  }

  /**
   * Rough token estimate: ~4 chars per token across system + all messages.
   *
   * This is a cheap heuristic (not a real tokenizer) used by the compaction
   * pipeline to decide when context is approaching the model's window limit.
   *
   * @returns Estimated token count (ceiling of chars / 4).
   */
  estimateTokens(): number {
    let chars = this.systemPrompt.length;
    for (const m of this.messages) {
      chars += estimateContentChars(m.content);
    }
    return Math.ceil(chars / 4);
  }

  /**
   * Find the most recent assistant message in the history.
   *
   * Walks the message list backward and returns the first message with
   * `role === 'assistant'`.
   *
   * @returns The last assistant message, or `undefined` if none exist.
   */
  lastAssistant(): Message | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') return this.messages[i];
    }
    return undefined;
  }
}

/**
 * Estimate the character count of message content for token estimation.
 *
 * Plain strings use `.length`.  Content blocks are summed by type:
 * text blocks count their text length, tool-use blocks count the JSON
 * length of their input plus the tool name, and tool-result blocks count
 * their content length.
 *
 * @param content - Either a string or an array of content blocks.
 * @returns Total character count.
 */
function estimateContentChars(content: string | ContentBlock[]): number {
  if (typeof content === 'string') return content.length;
  let chars = 0;
  for (const block of content) {
    if (block.type === 'text') chars += block.text.length;
    else if (block.type === 'tool_use') chars += JSON.stringify(block.input).length + block.name.length;
    else chars += block.content.length;
  }
  return chars;
}

/**
 * Serialize a content block list to a single string (for summaries / logs).
 *
 * Delegates to {@link extractText}, so tool-use and tool-result blocks are
 * not represented in the output — only text is included.
 *
 * @param content - Either a plain string or an array of content blocks.
 * @returns The concatenated text content.
 */
export function contentToString(content: string | ContentBlock[]): string {
  return extractText(content);
}
