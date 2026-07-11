/**
 * ConversationContext — the agent's mutable message history plus cheap
 * token-size estimation used by the compaction pipeline (tutorial s08).
 */

import type { ContentBlock, Message } from './types.js';
import { extractText } from './types.js';

export class ConversationContext {
  readonly messages: Message[] = [];
  private systemPrompt: string;

  constructor(systemPrompt: string, initial: Message[] = []) {
    this.systemPrompt = systemPrompt;
    this.messages.push(...initial);
  }

  get system(): string {
    return this.systemPrompt;
  }

  setSystem(prompt: string): void {
    this.systemPrompt = prompt;
  }

  append(message: Message): void {
    this.messages.push(message);
  }

  /** Replace the entire history (used by compaction layers). */
  replace(messages: Message[]): void {
    this.messages.length = 0;
    this.messages.push(...messages);
  }

  /** Rough token estimate: ~4 chars per token across system + all messages. */
  estimateTokens(): number {
    let chars = this.systemPrompt.length;
    for (const m of this.messages) {
      chars += estimateContentChars(m.content);
    }
    return Math.ceil(chars / 4);
  }

  lastAssistant(): Message | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') return this.messages[i];
    }
    return undefined;
  }
}

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

/** Serialize a content block list to a single string (for summaries / logs). */
export function contentToString(content: string | ContentBlock[]): string {
  return extractText(content);
}
