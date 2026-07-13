/**
 * Memory tools — let an agent read / write the unified Memory store.
 *
 * These tools give an agent persistent, queryable storage.  They wrap the
 * {@link Memory} interface, which supports typed entries (`user`, `feedback`,
 * `project`, `reference`) and keyword-based recall.  Agents use
 * `memory_write` to save facts, decisions, or user preferences across
 * turns, and `memory_read` to retrieve relevant context before acting.
 *
 * For vector-based semantic search, swap in a {@link VectorStore}-backed
 * Memory implementation — the tool interface stays the same.
 */

import { BaseTool } from '../core/tool.js';
import type { Memory, MemoryType } from '../memory/memory.js';

/**
 * Tool that persists a memory entry into the agent's Memory store.
 *
 * Entries are typed ({@link MemoryType}) so the agent can categorise what
 * it stores.  Each entry has a `name`, `description`, and freeform `body`.
 * The store assigns a unique ID for later retrieval or update.
 */
export class MemoryWriteTool extends BaseTool {
  readonly definition = {
    name: 'memory_write',
    description: 'Persist a memory entry (user / feedback / project / reference).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
        description: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['name', 'type', 'description', 'body'],
    },
  };

  /**
   * @param memory - The {@link Memory} instance to write to.
   */
  constructor(private memory: Memory) {
    super();
  }

  /**
   * Persist a typed memory entry.
   *
   * @param input - Raw input from the model.
   *   - `name` (string, required) — Short label for the memory.
   *   - `type` (string, required) — Category: `user`, `feedback`,
   *     `project`, or `reference`.
   *   - `description` (string, required) — One-line summary.
   *   - `body` (string, required) — Full content of the memory entry.
   * @returns A confirmation string with the saved entry's name and ID.
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    const entry = await this.memory.add({
      name: this.requireString(input, 'name'),
      type: this.requireString(input, 'type') as MemoryType,
      description: this.requireString(input, 'description'),
      body: this.requireString(input, 'body'),
    });
    return `Saved memory "${entry.name}" (id=${entry.id})`;
  }
}

/**
 * Tool that recalls memories relevant to a query string.
 *
 * The default {@link MarkdownMemory} implementation uses keyword matching
 * against the in-memory keyword index.  When an optional LLM is provided
 * to the Memory backend, the `query` method can also use LLM-based recall
 * for semantic relevance, but the tool itself is agnostic to the
 * underlying matching strategy.
 */
export class MemoryReadTool extends BaseTool {
  readonly definition = {
    name: 'memory_read',
    description: 'Recall up to k memories relevant to a query.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        k: { type: 'number' },
      },
      required: ['query'],
    },
  };

  /**
   * @param memory - The {@link Memory} instance to query.
   */
  constructor(private memory: Memory) {
    super();
  }

  /**
   * Query the memory store for relevant entries.
   *
   * @param input - Raw input from the model.
   *   - `query` (string, required) — Search string used for keyword
   *     (or LLM-assisted) matching.
   *   - `k` (number, optional) — Maximum number of results to return.
   *     Defaults to 5 when omitted.
   * @returns A formatted string of matching entries (name, type,
   *   description, body), separated by horizontal rules, or
   *   `"No relevant memories."` if nothing matches.
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    const query = this.requireString(input, 'query');
    const k = this.optionalNumber(input, 'k') ?? 5;
    const entries = await this.memory.query(query, k);
    if (entries.length === 0) return 'No relevant memories.';
    return entries.map((e) => `## ${e.name} [${e.type}]\n${e.description}\n\n${e.body}`).join('\n\n---\n\n');
  }
}

/**
 * Factory that creates the memory tool suite.
 *
 * Returns both `MemoryWriteTool` and `MemoryReadTool` wired to the same
 * {@link Memory} instance.
 *
 * @param memory - The {@link Memory} backend to share across tools.
 * @returns An array of `[MemoryWriteTool, MemoryReadTool]`.
 */
export function createMemoryTools(memory: Memory): Array<MemoryWriteTool | MemoryReadTool> {
  return [new MemoryWriteTool(memory), new MemoryReadTool(memory)];
}
