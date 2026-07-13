/**
 * LLM client abstraction and the Anthropic-compatible adapter.
 *
 * ## Design
 *
 * The `LLMClient` interface is intentionally minimal — a single `create`
 * method. This keeps the framework provider-agnostic: any model provider can
 * be plugged in by implementing one method, without dragging in provider-
 * specific types or dependencies.
 *
 * The adapter wraps `@anthropic-ai/sdk` and is the only place that talks to a
 * real model. Pointing `baseURL` at GLM's Anthropic-compatible endpoint
 * (`https://open.bigmodel.cn/api/anthropic`) lets the same SDK drive GLM-4.7
 * without any GLM-specific code.
 *
 * ## Translation layer
 *
 * The Anthropic SDK has its own type system (e.g. `Anthropic.Messages.
 * ContentBlock`, `Anthropic.Messages.MessageParam`). The translation helpers
 * (`toAnthropicMessages`, `toAnthropicContent`, `toAnthropicTools`,
 * `fromAnthropicBlock`) map between MochiKit's internal types and the SDK's
 * types. This isolates the SDK dependency to this single file — if the SDK
 * types change, only the helpers need updating.
 *
 * ## Why `fetch` override exists
 *
 * The `AnthropicAdapterOptions.fetch` option allows injecting a custom
 * `fetch` implementation. This serves two use cases:
 * 1. **Testing** — mock fetch to simulate network responses without hitting
 *    a real endpoint.
 * 2. **Proxies** — route requests through a corporate proxy or debugging
 *    proxy (e.g. mitmproxy) without changing environment-level fetch.
 *
 * The cast `opts.fetch as never` is used because the Anthropic SDK's
 * `ClientOptions.fetch` type does not exactly match the standard `typeof
 * fetch` — it expects a narrower signature. The `as never` bypasses the type
 * mismatch while passing through the actual function.
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

/**
 * Minimal contract for an LLM client.
 *
 * The framework only needs one method: send a request and get a response.
 * There is no streaming, no cancellation, no model listing — those are
 * provider-specific concerns that can be added by extending this interface
 * or using provider-specific adapters.
 *
 * ## Why not include `stream()`?
 *
 * Streaming is provider-specific. The Anthropic SDK has its own streaming
 * types (`Anthropic.Messages.RawMessageStreamEvent`), and OpenAI's are
 * different. Keeping the interface minimal avoids coupling the framework
 * to one provider's streaming model. If streaming is needed, the caller
 * can work with the adapter directly.
 */
export interface LLMClient {
  /**
   * Send a message request to the LLM and return the response.
   *
   * @param params — Request parameters (model, system prompt,
   *   messages, tools, max_tokens).
   * @returns The LLM's response with content blocks, stop reason,
   *   and optional usage data.
   * @throws {Error} — On network failure, authentication error, or
   *   API error (status code >= 400).
   */
  create(params: LLMCreateParams): Promise<LLMResponse>;
}

/**
 * Configuration options for the Anthropic adapter.
 *
 * The adapter wraps `@anthropic-ai/sdk` and translates between MochiKit's
 * internal types and the Anthropic SDK types. The `baseURL` option allows
 * pointing at Anthropic-compatible endpoints (e.g. GLM) without changing
 * any client code.
 */
export interface AnthropicAdapterOptions {
  /** API key for authentication. Sent as `x-api-key` header. */
  apiKey: string;
  /**
   * Base URL for the Anthropic-compatible API endpoint.
   *
   * Defaults to Anthropic's production endpoint. Set to
   * `https://open.bigmodel.cn/api/anthropic` for GLM-4.7, or any other
   * Anthropic-compatible provider.
   */
  baseURL?: string;
  /**
   * Optional fetch override (for testing / proxies).
   *
   * In tests, this can be a mocked fetch that returns canned responses.
   * In production with a proxy, this can be a fetch that routes through
   * the proxy without changing `NODE_TLS_REJECT_UNAUTHORIZED` or other
   * environment-level settings.
   */
  fetch?: typeof fetch;
}

/**
 * Anthropic SDK adapter implementing the `LLMClient` interface.
 *
 * This is the primary production adapter. It translates MochiKit's
 * `LLMCreateParams` into the Anthropic SDK's `MessagesCreateParams`,
 * calls the SDK, and translates the response back into MochiKit's
 * `LLMResponse` format.
 *
 * ## GLM compatibility
 *
 * GLM-4.7 exposes an Anthropic-compatible Messages API at
 * `https://open.bigmodel.cn/api/anthropic`. By setting `baseURL` to that
 * endpoint and using a GLM API key, the same adapter works with GLM
 * without a separate GLM SDK dependency.
 */
export class AnthropicAdapter implements LLMClient {
  /** The underlying Anthropic SDK client instance. */
  private client: Anthropic;

  /**
   * @param opts — Configuration for the adapter.
   * @param opts.apiKey — API key for the target endpoint.
   * @param opts.baseURL — Optional base URL override for non-Anthropic
   *   providers or proxies.
   * @param opts.fetch — Optional fetch implementation override for
   *   testing or proxy scenarios.
   */
  constructor(opts: AnthropicAdapterOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      // IMPORTANT: Only spread optional fields that are actually defined.
      // Passing `undefined` for `baseURL` or `fetch` would cause the SDK
      // to use `undefined` instead of its own defaults.
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.fetch ? { fetch: opts.fetch as never } : {}),
    });
  }

  /**
   * Send a message request through the Anthropic SDK and translate the
   * response back to MochiKit's `LLMResponse` format.
   *
   * @param params — Request parameters.
   * @param params.model — Model identifier (e.g. "claude-sonnet-4-20250514").
   * @param params.system — System prompt string.
   * @param params.max_tokens — Maximum tokens the model may generate.
   * @param params.messages — Conversation history in MochiKit format.
   * @param params.tools — Tool definitions in MochiKit format.
   * @returns The LLM response with content, stop_reason, and usage.
   * @throws {Error} — On API errors (auth, rate limit, etc.) from the
   *   underlying SDK call.
   */
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
      // NOTE: Anthropic's stop_reason can be undefined in some edge cases
      // (e.g. when the stream is interrupted). Default to 'end_turn' for
      // safety since MochiKit's stop_reason field must always be present.
      stop_reason: response.stop_reason ?? 'end_turn',
      usage: response.usage
        ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
        : undefined,
    };
  }
}

// --- translation helpers ---

/** Alias for the Anthropic SDK's content block union type. */
type AnthropicContentBlock = Anthropic.Messages.ContentBlock;

/**
 * Translate MochiKit's `Message[]` into the Anthropic SDK's
 * `MessageParam[]`.
 *
 * Note: MochiKit's `Message.role` is `'system' | 'user' | 'assistant'`,
 * but Anthropic only accepts `'user' | 'assistant'` in the messages array
 * (system prompts go via the `system` parameter). Any `'system'` role
 * messages are coerced to `'user'` as a fallback.
 *
 * @param messages — Messages in MochiKit's internal format.
 * @returns Messages in the Anthropic SDK's format.
 */
function toAnthropicMessages(messages: Message[]): Anthropic.Messages.MessageParam[] {
  return messages.map((m) => ({
    role: m.role === 'system' ? 'user' : m.role,
    content: toAnthropicContent(m.content),
  }));
}

/**
 * Translate MochiKit's content (string or `ContentBlock[]`) into the
 * Anthropic SDK's content format.
 *
 * Handles all three MochiKit block types:
 * - `text` → `{ type: 'text', text }`
 * - `tool_use` → `{ type: 'tool_use', id, name, input }`
 * - `tool_result` → `{ type: 'tool_result', tool_use_id, content, is_error? }`
 *
 * The `as never` casts on `input` are needed because the Anthropic SDK
 * types `input` as a specific JSON object shape, while MochiKit stores it
 * as `Record<string, unknown>`. This is safe because the SDK serializes
 * input to JSON at the HTTP level anyway.
 *
 * @param content — MochiKit content (string or `ContentBlock[]`).
 * @returns Anthropic SDK-compatible content.
 */
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
      // NOTE: Only include `is_error` when true — the Anthropic API
      // treats an explicit `is_error: false` the same as omitting it,
      // so we save a few bytes by omitting it.
      ...(b.is_error ? { is_error: true } : {}),
    };
  });
}

/**
 * Translate MochiKit's `ToolDefinition[]` into the Anthropic SDK's
 * `Tool[]` format.
 *
 * Each tool definition carries a `name`, `description`, and
 * `input_schema` (JSON Schema object). The `as Anthropic.Messages.Tool.
 * InputSchema` cast is needed because the SDK uses a more specific type
 * for JSON Schema than MochiKit's generic `Record<string, unknown>`.
 *
 * @param tools — Tool definitions in MochiKit format.
 * @returns Tool definitions in the Anthropic SDK's format. If `tools` is
 *   undefined, returns `undefined` (tools are not sent).
 */
function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
  }));
}

/**
 * Translate a single Anthropic SDK content block back into MochiKit's
 * `ContentBlock` format.
 *
 * ## Handling unknown block types
 *
 * The Anthropic API occasionally returns block types that MochiKit doesn't
 * have dedicated types for (e.g. `thinking`, `redacted_thinking`). Instead
 * of dropping them silently, they are flattened to `{ type: 'text', text:
 * JSON.stringify(b) }`. This ensures:
 * 1. No information is lost.
 * 2. The model can still see/reference the content in subsequent turns.
 * 3. MochiKit doesn't need to keep up with every new Anthropic block type.
 *
 * @param b — A single content block from the Anthropic SDK response.
 * @returns A MochiKit `ContentBlock` (text, tool_use, or JSON-flattened
 *   text for unknown types).
 */
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
