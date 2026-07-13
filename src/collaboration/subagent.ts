/**
 * Subagent — one-off delegation with context isolation (tutorial s06).
 *
 * A subagent runs with a **reset** (fresh) message history and returns only
 * its final text summary, so the delegating agent's context window stays
 * clean. This is the core delegation primitive used by the ManagerWorker
 * pattern and can also be called directly.
 *
 * ## Context isolation
 * Calling `agent.reset()` clears the agent's message history but preserves
 * its configuration (system prompt, tools, hooks, permissions, memory). The
 * agent behaves like a fresh instance but keeps all its registered
 * capabilities.
 *
 * ## spawnSubagent vs direct agent.run()
 * - `spawnSubagent(agent, task)` — resets context first, returns only the
 *   final text. Safe for repeated delegation; no cross-task contamination.
 * - `agent.run(task)` — appends to the existing message history. Suitable
 *   for ongoing conversations.
 */

import type { Agent } from '../core/agent.js';
import { BaseTool } from '../core/tool.js';
import type { Tool } from '../core/tool.js';

/**
 * Run an agent on a sub-task with a fresh (reset) context, returning only its
 * final text output. This is the preferred way to delegate work without
 * leaking context between invocations.
 *
 * @param agent - The agent instance to execute the sub-task.
 * @param task - The sub-task description (prompt) for the agent.
 * @returns The agent's final text response after running the sub-task.
 */
export async function spawnSubagent(agent: Agent, task: string): Promise<string> {
  agent.reset();
  return agent.run(task);
}

/**
 * Tool that lets a manager agent delegate sub-tasks to named worker agents
 * via `spawn_teammate`.
 *
 * The worker registry is **closed over** at construction time — the LLM can
 * only spawn workers that were registered. This prevents prompt-injection
 * attacks that might try to invoke arbitrary agents.
 *
 * ## Tool behavior
 * 1. The LLM calls `spawn_teammate` with a `worker` name and a `task`
 *    string.
 * 2. `execute()` looks up the worker in the registry. If unknown, returns an
 *    error with the list of available workers.
 * 3. The worker runs via {@link spawnSubagent}, which resets its context and
 *    returns only the final text.
 * 4. The result is wrapped with the worker's name prefix and returned to the
 *    LLM.
 *
 * @see {@link spawnSubagent} for the underlying delegation primitive.
 */
export class SpawnSubagentTool extends BaseTool {
  /** Tool definition sent to the LLM. */
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

  /**
   * Create a SpawnSubagentTool with a fixed worker registry.
   *
   * @param workers - Map of worker name to `Agent` instance. Only these
   *   workers can be spawned by the LLM.
   */
  constructor(private workers: Map<string, Agent>) {
    super();
  }

  /**
   * Execute a `spawn_teammate` call from the LLM.
   *
   * @param input - Parsed tool input with `worker` (string) and `task`
   *   (string) fields.
   * @returns The worker's result prefixed with the worker name, or an error
   *   string if the worker is unknown or execution fails.
   */
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

/**
 * Convenience factory for creating a `SpawnSubagentTool` from a worker map.
 *
 * @param workers - Map of worker name to `Agent` instance.
 * @returns A new `Tool` instance ready for registration on a manager agent.
 */
export function createSpawnSubagentTool(workers: Map<string, Agent>): Tool {
  return new SpawnSubagentTool(workers);
}
