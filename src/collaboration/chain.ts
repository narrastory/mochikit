/**
 * SequentialChain — a linear pipeline where each agent's output feeds the next
 * (tutorial s07).
 *
 * Agents are run **in order**. The first agent receives the original `input`
 * string; every subsequent agent receives the full text output of the
 * previous agent. Optionally, all agents can share a {@link Memory} instance
 * so that later stages can recall notes written by earlier ones.
 *
 * ## Contrast with other patterns
 * - **SequentialChain** is deterministic: the order of agents is fixed at
 *   construction time and every agent runs exactly once.
 * - **ManagerWorker** is dynamic: a single manager decides at runtime which
 *   worker(s) to invoke and with what task.
 * - **Team** is peer-to-peer: agents communicate freely via a shared
 *   MessageBus rather than passing outputs forward.
 *
 * ## When to use
 * - Multi-step pipelines (e.g. research -> draft -> edit).
 * - Transformations where each stage refines or annotates the previous output.
 * - Workflows where intermediate context should be preserved in shared memory.
 */

import type { Agent } from '../core/agent.js';
import type { Memory } from '../memory/memory.js';

/**
 * Options for constructing a {@link SequentialChain}.
 */
export interface SequentialChainOptions {
  /** Agents to run in sequence. Index 0 runs first, last runs last. */
  agents: Agent[];
  /**
   * Optional shared Memory instance. When provided, each agent can read and
   * write to the same memory store, allowing later stages to recall notes
   * left by earlier ones.
   */
  sharedMemory?: Memory;
}

/**
 * Implements the **Sequential Chain** collaboration pattern.
 *
 * A fixed sequence of agents is executed one after another. The first agent
 * receives the user's input; each subsequent agent receives the previous
 * agent's output as its input. An optional shared {@link Memory} allows
 * agents to persist and recall information across stages without passing
 * everything through the text pipeline.
 *
 * @example
 * ```ts
 * const chain = new SequentialChain({
 *   agents: [researcher, drafter, editor],
 *   sharedMemory: new MarkdownMemory('./memory'),
 * });
 * const result = await chain.run('Write about TypeScript decorators');
 * ```
 */
export class SequentialChain {
  /** The ordered list of agents in the chain. */
  readonly agents: Agent[];
  /** Shared memory instance, or `undefined` if not configured. */
  readonly memory?: Memory;

  /**
   * Create a SequentialChain.
   *
   * @param opts - Configuration: a non-empty array of agents and optional
   *   shared memory.
   */
  constructor(opts: SequentialChainOptions) {
    this.agents = opts.agents;
    this.memory = opts.sharedMemory;
  }

  /**
   * Execute the chain. Each agent runs in order; its output becomes the next
   * agent's input.
   *
   * @param input - The initial prompt or task description.
   * @returns The final agent's text output.
   */
  async run(input: string): Promise<string> {
    let output = input;
    for (const agent of this.agents) {
      output = await agent.run(output);
    }
    return output;
  }
}
