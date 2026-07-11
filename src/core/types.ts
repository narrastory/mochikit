/**
 * MochiKit core type definitions.
 *
 * These mirror the Anthropic Messages API content-block model so the
 * {@link AnthropicAdapter} can pass through with minimal translation, while
 * remaining generic enough for alternative LLM backends.
 */

export type Role = 'system' | 'user' | 'assistant';

/** A plain text content block. */
export interface TextBlock {
  type: 'text';
  text: string;
}

/** A request from the model to invoke a tool. */
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** The result of a tool invocation, fed back to the model. */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

/** JSON-Schema-described tool definition exposed to the model. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type StopReason = 'tool_use' | 'end_turn' | 'max_tokens' | 'stop_sequence' | string;

export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: StopReason;
  /** Optional usage telemetry from the provider. */
  usage?: { input_tokens: number; output_tokens: number };
}

/** Parameters for {@link LLMClient.create}. */
export interface LLMCreateParams {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  max_tokens: number;
}

/** Extract text blocks from a message's content. */
export function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Extract tool-use blocks from a message's content. */
export function extractToolUses(content: string | ContentBlock[]): ToolUseBlock[] {
  if (typeof content === 'string') return [];
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
}
