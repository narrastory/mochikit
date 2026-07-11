/**
 * Subagent — one-off delegation with context isolation (tutorial s06).
 *
 * A subagent runs with a fresh message history and returns only its final
 * summary, so the delegating agent's context stays clean.
 */

import type { Agent } from '../core/agent.js';
import { BaseTool } from '../core/tool.js';
import type { Tool } from '../core/tool.js';

/** Run an agent on a sub-task with a reset context; return its final text. */
export async function spawnSubagent(agent: Agent, task: string): Promise<string> {
  agent.reset();
  return agent.run(task);
}

/**
 * Tool that lets a manager delegate to a named worker. The worker registry is
 * closed over so the model can only spawn known workers.
 */
export class SpawnSubagentTool extends BaseTool {
  readonly definition = {
    name: 'spawn_teammate',
    description:
      'Delegate a sub-task to a named worker agent and return its result summary. ' +
      'Use for isolated, well-scoped subtasks.',
    input_schema: {
      type: 'object',
      properties: {
        worker: { type: 'string', description: 'Name of the worker to delegate to' },
        task: { type: 'string', description: 'Self-contained description of the sub-task' },
      },
      required: ['worker', 'task'],
    },
  };

  constructor(private workers: Map<string, Agent>) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const name = this.requireString(input, 'worker');
    const task = this.requireString(input, 'task');
    const worker = this.workers.get(name);
    if (!worker) return `Error: unknown worker "${name}". Available: ${[...this.workers.keys()].join(', ')}`;
    try {
      const result = await spawnSubagent(worker, task);
      return `Worker "${name}" result:\n${result}`;
    } catch (err) {
      return `Worker "${name}" failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export function createSpawnSubagentTool(workers: Map<string, Agent>): Tool {
  return new SpawnSubagentTool(workers);
}
