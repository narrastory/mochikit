/**
 * Team — a set of peer agents that communicate via a shared MessageBus
 * (tutorial s09).
 *
 * Unlike hierarchical patterns (ManagerWorker, SequentialChain), a **Team**
 * is flat: every member can send messages to any other member and can check
 * its own inbox for incoming messages. Members are run independently — the
 * caller decides when to invoke each one.
 *
 * ## Mechanics
 * Each member is equipped with two tools:
 * - `send_message` — sends a text message to another team member's inbox on
 *   the shared bus.
 * - `check_inbox` — reads (consumes) all pending messages from the member's
 *   own inbox (FIFO order).
 *
 * Messages are delivered via the team's {@link MessageBus}. By default an
 * {@link InMemoryMessageBus} is used, but any bus implementation (e.g.
 * file-backed) can be injected.
 *
 * ## Contrast with other patterns
 * - **Team** is peer-to-peer: any member can reach any other; there is no
 *   fixed order or designated leader.
 * - **SequentialChain** is linear: output flows forward, no back-and-forth.
 * - **ManagerWorker** is star-topology: only the manager can delegate, and
 *   workers never talk to each other.
 *
 * ## When to use
 * - Collaborative problem-solving where agents need to negotiate or share
 *   partial results.
 * - Simulations where multiple agents operate on a shared task concurrently.
 * - Scenarios requiring ad-hoc communication rather than a predetermined
 *   pipeline.
 */

import type { Agent } from '../core/agent.js';
import { InMemoryMessageBus } from '../infra/message-bus.js';
import type { MessageBus } from '../infra/message-bus.js';
import { createTeamTools } from '../tools/team-tools.js';

/**
 * Options for constructing a {@link Team}.
 */
export interface TeamOptions {
  /** Team members. Each must have a unique `name`. */
  members: Agent[];
  /**
   * Optional MessageBus. When omitted, an {@link InMemoryMessageBus} is
   * created automatically. Provide a custom bus (e.g. file-backed) for
   * persistence or cross-process communication.
   */
  bus?: MessageBus;
}

/**
 * Implements the **Team** collaboration pattern.
 *
 * A flat group of agents that communicate via a shared {@link MessageBus}.
 * Each member is equipped with `send_message` and `check_inbox` tools on
 * construction. Members are invoked independently by name; they can discover
 * and respond to messages from peers during their runs.
 *
 * @example
 * ```ts
 * const team = new Team({ members: [alice, bob, charlie] });
 * // Run alice; she can send messages to bob's inbox.
 * await team.run('alice', 'Research topic X and ask Bob for a review.');
 * // Later, run bob; he can check his inbox for alice's message.
 * await team.run('bob', 'Check your inbox and respond to requests.');
 * ```
 */
export class Team {
  /** Team members keyed by name. */
  readonly members = new Map<string, Agent>();
  /** The shared message bus. */
  readonly bus: MessageBus;

  /**
   * Create a Team, registering `send_message` / `check_inbox` tools on every
   * member.
   *
   * @param opts - Configuration: members array and optional custom bus.
   */
  constructor(opts: TeamOptions) {
    this.bus = opts.bus ?? new InMemoryMessageBus();
    for (const m of opts.members) {
      this.members.set(m.name, m);
      for (const tool of createTeamTools(this.bus, m.name)) m.registerTool(tool);
    }
  }

  /**
   * Look up a team member by name.
   *
   * @param name - The member's name (must match `Agent.name`).
   * @returns The agent instance, or `undefined` if not found.
   */
  member(name: string): Agent | undefined {
    return this.members.get(name);
  }

  /**
   * Run a single team member with the given input. The member can send
   * messages to and check messages from other members during its run.
   *
   * @param memberName - The name of the team member to invoke.
   * @param input - The task description or prompt.
   * @returns The member's final text output.
   * @throws {Error} If `memberName` does not match any registered member.
   */
  async run(memberName: string, input: string): Promise<string> {
    const m = this.members.get(memberName);
    if (!m) throw new Error(`Unknown team member: ${memberName}`);
    return m.run(input);
  }
}
