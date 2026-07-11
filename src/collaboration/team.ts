/**
 * Team — a set of agents that communicate via a shared MessageBus.
 *
 * Each member is equipped with `send_message` / `check_inbox` tools bound to
 * the bus. Members can be run independently; their inbox acts as a queue.
 */

import type { Agent } from '../core/agent.js';
import { InMemoryMessageBus } from '../infra/message-bus.js';
import type { MessageBus } from '../infra/message-bus.js';
import { createTeamTools } from '../tools/team-tools.js';

export interface TeamOptions {
  members: Agent[];
  bus?: MessageBus;
}

export class Team {
  readonly members = new Map<string, Agent>();
  readonly bus: MessageBus;

  constructor(opts: TeamOptions) {
    this.bus = opts.bus ?? new InMemoryMessageBus();
    for (const m of opts.members) {
      this.members.set(m.name, m);
      for (const tool of createTeamTools(this.bus, m.name)) m.registerTool(tool);
    }
  }

  member(name: string): Agent | undefined {
    return this.members.get(name);
  }

  /** Run a single member on an input. */
  async run(memberName: string, input: string): Promise<string> {
    const m = this.members.get(memberName);
    if (!m) throw new Error(`Unknown team member: ${memberName}`);
    return m.run(input);
  }
}
