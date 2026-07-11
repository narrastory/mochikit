/**
 * LLM client abstraction and the Anthropic-compatible adapter.
 *
 * The adapter wraps `@anthropic-ai/sdk` and is the only place that talks to a
 * real model. Pointing `baseURL` at GLM's Anthropic-compatible endpoint
 * (`https://open.bigmodel.cn/api/anthropic`) lets the same SDK drive GLM-4.7.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  LLMCreateParams,
  LLMResponse,
  Message,
  ToolDefinition,
} from './types.js';

export type { LLMCreateParams, LLMResponse };

export interface LLMClient {
  create(params: LLMCreateParams): Promise<LLMResponse>;
}

export interface AnthropicAdapterOptions {
  apiKey: string;
  baseURL?: string;
  /** Optional fetch override (for testing / proxies). */
  fetch?: typeof fetch;
}

export class AnthropicAdapter implements LLMClient {
  private client: Anthropic;

  constructor(opts: AnthropicAdapterOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.fetch ? { fetch: opts.fetch as never } : {}),
    });
  }

  async create(params: LLMCreateParams): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: params.model,
      system: params.system,
      max_tokens: params.max_tokens,
      messages: toAnthropicMessages(params.messages),
      tools: toAnthropicTools(params.tools),
    });

    return {
      content: response.content.map(fromAnthropicBlock),
      stop_reason: response.stop_reason ?? 'end_turn',
      usage: response.usage
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  }
}

// --- translation helpers ---

type AnthropicContentBlock = Anthropic.Messages.ContentBlock;

function toAnthropicMessages(messages: Message[]): Anthropic.Messages.MessageParam[] {
  return messages.map((m) => ({
    role: m.role === 'system' ? 'user' : m.role,
    content: toAnthropicContent(m.content),
  }));
}

function toAnthropicContent(content: string | ContentBlock[]): Anthropic.Messages.MessageParam['content'] {
  if (typeof content === 'string') return content;
  return content.map((b) => {
    if (b.type === 'text') return { type: 'text', text: b.text };
    if (b.type === 'tool_use') {
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input as never };
    }
    return {
      type: 'tool_result',
      tool_use_id: b.tool_use_id,
      content: b.content,
      ...(b.is_error ? { is_error: true } : {}),
    };
  });
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
  }));
}

function fromAnthropicBlock(b: AnthropicContentBlock): ContentBlock {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input as Record<string, unknown> };
    default:
      // Other block types (e.g. thinking) are flattened to text for portability.
      return { type: 'text', text: JSON.stringify(b) };
  }
}
