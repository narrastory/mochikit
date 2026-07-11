/**
 * Memory tools — let an agent read/write the unified Memory store.
 */

import { BaseTool } from '../core/tool.js';
import type { Memory, MemoryType } from '../memory/memory.js';

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

  constructor(private memory: Memory) {
    super();
  }

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

  constructor(private memory: Memory) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = this.requireString(input, 'query');
    const k = this.optionalNumber(input, 'k') ?? 5;
    const entries = await this.memory.query(query, k);
    if (entries.length === 0) return 'No relevant memories.';
    return entries.map((e) => `## ${e.name} [${e.type}]\n${e.description}\n\n${e.body}`).join('\n\n---\n\n');
  }
}

export function createMemoryTools(memory: Memory): Array<MemoryWriteTool | MemoryReadTool> {
  return [new MemoryWriteTool(memory), new MemoryReadTool(memory)];
}
