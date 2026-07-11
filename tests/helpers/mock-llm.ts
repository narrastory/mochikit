import type { LLMClient, LLMCreateParams, LLMResponse } from '../../src/index.js';

/**
 * Scripted LLM client for unit tests. Returns queued responses in order,
 * optionally inspecting params via a predicate.
 */
export class MockLLMClient implements LLMClient {
  private queue: LLMResponse[] = [];
  public calls: LLMCreateParams[] = [];

  constructor(responses?: LLMResponse[]) {
    if (responses) this.queue.push(...responses);
  }

  enqueue(responses: LLMResponse[]): this {
    this.queue.push(...responses);
    return this;
  }

  async create(params: LLMCreateParams): Promise<LLMResponse> {
    // Snapshot params so later context mutation doesn't rewrite call history.
    this.calls.push(JSON.parse(JSON.stringify(params)) as LLMCreateParams);
    const next = this.queue.shift();
    if (!next) throw new Error('MockLLMClient: response queue empty');
    return next;
  }
}

export function textResponse(text: string): LLMResponse {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
}

export function toolUseResponse(id: string, name: string, input: Record<string, unknown>): LLMResponse {
  return {
    content: [{ type: 'text', text: `calling ${name}` }, { type: 'tool_use', id, name, input }],
    stop_reason: 'tool_use',
  };
}

export function toolUseThenText(
  id: string,
  name: string,
  input: Record<string, unknown>,
  finalText: string,
): LLMResponse[] {
  return [toolUseResponse(id, name, input), textResponse(finalText)];
}
