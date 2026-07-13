/**
 * Manager-Worker collaboration pattern (tutorial s06 / s15).
 *
 * In this pattern a single **manager agent** is given a `spawn_teammate` tool
 * bound to a registry of **worker agents**. When the manager invokes that tool
 * the worker runs with an **isolated message history** — the manager only sees
 * a summary of the worker's result, keeping its own context lean.
 *
 * ## Contrast with other patterns
 * - **ManagerWorker** is dynamic: the manager decides at runtime which worker
 *   to call and with what task. Workers do not communicate with each other.
 * - **SequentialChain** is linear: each agent's full output feeds the next.
 * - **Team** is peer-to-peer: all members share a MessageBus and can message
 *   anyone.
 *
 * ## Lifecycle
 * 1. A `ManagerWorker` is constructed with a manager `Agent` and a list of
 *    `WorkerSpec` entries.
 * 2. The constructor registers a `SpawnSubagentTool` on the manager, closing
 *    over the worker map so the model can only spawn known workers.
 * 3. `run(input)` calls `manager.run(input)`. The LLM may choose to delegate
 *    via `spawn_teammate` at any point; each delegation resets the worker's
 *    context and returns only the final text.
 */

import type { Agent } from '../core/agent.js';
import { SpawnSubagentTool } from './subagent.js';

/**
 * Descriptor for a single worker in the manager's pool.
 *
 * Each worker is an independent `Agent` instance with its own tools, hooks,
 * and permissions. When delegated to, the worker runs in a fresh context
 * (via `spawnSubagent`) so prior invocations do not leak.
 */
export interface WorkerSpec {
  /** Human-readable name the manager uses to reference this worker. */
  name: string;
  /** The agent instance that executes delegated sub-tasks. */
  agent: Agent;
}

/**
 * Options for constructing a {@link ManagerWorker}.
 */
export interface ManagerWorkerOptions {
  /** The manager agent — receives the `spawn_teammate` tool. */
  manager: Agent;
  /** Pool of workers the manager may delegate to at runtime. */
  workers: WorkerSpec[];
}

/**
 * Implements the **Manager-Worker** collaboration pattern.
 *
 * The manager agent is equipped with a `spawn_teammate` tool that allows it
 * to dynamically delegate sub-tasks to named workers. Each worker invocation
 * is context-isolated: the worker starts with a fresh message history and
 * only its final text response is returned to the manager.
 *
 * Use this pattern when:
 * - Tasks can be decomposed into independent, well-scoped sub-tasks.
 * - The manager benefits from delegating to specialists with different tool
 *   sets or system prompts.
 * - You want to keep the manager's context window clean by only surfacing
 *   summaries, not full conversation transcripts.
 */
export class ManagerWorker {
  /** The manager agent (receives `spawn_teammate`). */
  readonly manager: Agent;
  /** Worker pool keyed by name. */
  readonly workers = new Map<string, Agent>();

  /**
   * Create a ManagerWorker instance and register the delegation tool on the
   * manager.
   *
   * @param opts - Configuration containing the manager agent and worker pool.
   */
  constructor(opts: ManagerWorkerOptions) {
    this.manager = opts.manager;
    for (const w of opts.workers) this.workers.set(w.name, w.agent);
    // Equip the manager with the delegation tool.
    this.manager.registerTool(new SpawnSubagentTool(this.workers));
  }

  /**
   * Run the manager agent. The manager may delegate to workers at any point
   * during its execution via the `spawn_teammate` tool.
   *
   * @param input - The task description or prompt for the manager.
   * @returns The manager's final text response after all delegation is complete.
   */
  async run(input: string): Promise<string> {
    return this.manager.run(input);
  }
}
