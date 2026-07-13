/**
 * MochiKit core type definitions.
 *
 * These mirror the Anthropic Messages API content-block model so the
 * {@link AnthropicAdapter} can pass through with minimal translation, while
 * remaining generic enough for alternative LLM backends.
 *
 * ## Content-block discriminated union
 *
 * Every turn in the agent loop produces a {@link Message} whose `content` is
 * either a plain string or an array of {@link ContentBlock}.  The three block
 * types form a discriminated union on the `type` field:
 *
 * - {@link TextBlock} — plain text (role: assistant or user).
 * - {@link ToolUseBlock} — the model requests a tool invocation (role: assistant).
 * - {@link ToolResultBlock} — the harness feeds the result back (role: user).
 *
 * This mirrors the Anthropic Messages API content-block model so that the
 * {@link AnthropicAdapter} (see `src/core/llm-client.ts`) can pass through
 * with minimal translation.
 */

/**
 * The role of a message in the conversation.
 *
 * - `system`:  top-level system prompt (passed separately, not as a message).
 * - `user`:    input from the human or tool-result blocks fed back to the model.
 * - `assistant`: model output — text and/or tool-use requests.
 */
export type Role = 'system' | 'user' | 'assistant';

/**
 * A plain text content block.
 *
 * This is the simplest block type — a single string of text.  Assistant
 * messages often contain a single `TextBlock` with the model's response, but
 * they may also interleave text and tool-use blocks within the same message.
 */
export interface TextBlock {
  type: 'text';
  /** The text content. */
  text: string;
}

/**
 * A request from the model to invoke a tool.
 *
 * When the model decides to use a tool it emits a `ToolUseBlock` with a
 * unique {@link id}, the tool {@link name}, and an {@link input} object
 * whose shape must conform to the tool's {@link ToolDefinition.input_schema}.
 * The agent loop dispatches this block through {@link ToolRegistry} and feeds
 * back a corresponding {@link ToolResultBlock}.
 */
export interface ToolUseBlock {
  type: 'tool_use';
  /** Unique identifier for this tool-use request (matches ToolResultBlock.tool_use_id). */
  id: string;
  /** Name of the tool to invoke (must match a registered ToolDefinition.name). */
  name: string;
  /** Arguments for the tool, validated against the tool's input_schema. */
  input: Record<string, unknown>;
}

/**
 * The result of a tool invocation, fed back to the model.
 *
 * After the agent loop executes a tool, it constructs a `ToolResultBlock`
 * and appends it to the conversation as a user-role message.  This is how
 * the model sees the outcome of its tool-use requests.
 */
export interface ToolResultBlock {
  type: 'tool_result';
  /** Matches the {@link ToolUseBlock.id} that triggered this invocation. */
  tool_use_id: string;
  /** The result payload — typically a stringified JSON or human-readable summary. */
  content: string;
  /** When `true`, the model will treat this as a tool-execution error. */
  is_error?: boolean;
}

/**
 * Discriminated union of all possible content blocks in a message.
 *
 * Use `block.type` to narrow: `'text'` → {@link TextBlock},
 * `'tool_use'` → {@link ToolUseBlock}, `'tool_result'` → {@link ToolResultBlock}.
 */
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

/**
 * A single message in the conversation history.
 *
 * The `content` field is a union type: it can be a plain `string` (typical
 * for simple user messages) or a `ContentBlock[]` (used by assistant messages
 * that may interleave text and tool-use blocks, and by user messages that
 * carry tool-result blocks).
 */
export interface Message {
  /** Who sent this message. */
  role: Role;
  /** Either a plain string or an array of typed content blocks. */
  content: string | ContentBlock[];
}

/**
 * JSON-Schema-described tool definition exposed to the model.
 *
 * Each tool registered in {@link ToolRegistry} produces one
 * `ToolDefinition` that is sent to the LLM as part of the `tools`
 * parameter.  The model uses these definitions to decide when and how
 * to emit {@link ToolUseBlock} requests.
 */
export interface ToolDefinition {
  /** Unique name used by the model to request this tool. */
  name: string;
  /** Human-readable description that helps the model decide when to use this tool. */
  description: string;
  /** JSON Schema object describing the expected input shape. */
  input_schema: Record<string, unknown>;
}

/**
 * Reason the model stopped generating.
 *
 * Common values:
 * - `'tool_use'` — model wants to invoke a tool and is waiting for results.
 * - `'end_turn'` — model finished its response naturally.
 * - `'max_tokens'` — output truncated by the `max_tokens` limit.
 * - `'stop_sequence'` — model hit a custom stop sequence.
 *
 * The `string` fallback allows provider-specific stop reasons.
 */
export type StopReason = 'tool_use' | 'end_turn' | 'max_tokens' | 'stop_sequence' | string;

/**
 * Normalised response from the LLM, regardless of provider.
 *
 * {@link LLMClient.create} returns this structure after every call.
 * The agent loop inspects {@link stop_reason} to decide whether to
 * dispatch tools or end the turn.
 */
export interface LLMResponse {
  /** The content blocks produced by the model (text, tool-use, or both). */
  content: ContentBlock[];
  /** Why the model stopped — drives the agent loop's next action. */
  stop_reason: StopReason;
  /** Optional usage telemetry from the provider. */
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Parameters for {@link LLMClient.create}.
 *
 * Bundles everything the LLM needs for a single inference call: model
 * identifier, system prompt, conversation history, tool definitions, and
 * token budget.  The agent loop constructs one of these per turn.
 */
export interface LLMCreateParams {
  /** Provider-specific model identifier (e.g. `"glm-4"`). */
  model: string;
  /** The assembled system prompt string. */
  system: string;
  /** Ordered conversation history. */
  messages: Message[];
  /** Tool definitions available to the model for this call. */
  tools: ToolDefinition[];
  /** Maximum tokens the model may generate in its response. */
  max_tokens: number;
}

/**
 * Extract text blocks from a message's content.
 *
 * If the content is already a string it is returned as-is.  Otherwise, all
 * {@link TextBlock} entries are joined with newlines.
 *
 * @param content - Either a plain string or an array of content blocks.
 * @returns The concatenated text from all text blocks, or the original string.
 */
export function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Extract tool-use blocks from a message's content.
 *
 * String content (which never contains tool-use blocks) returns an empty
 * array.  Otherwise every {@link ToolUseBlock} in the array is collected.
 *
 * @param content - Either a plain string or an array of content blocks.
 * @returns An array of {@link ToolUseBlock} entries (may be empty).
 */
export function extractToolUses(content: string | ContentBlock[]): ToolUseBlock[] {
  if (typeof content === 'string') return [];
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}
