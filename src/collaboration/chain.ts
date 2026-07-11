/**
 * SequentialChain — run a sequence of agents, feeding each output into the
 * next. Optionally shares a Memory so later stages can recall earlier notes.
 */

import type { Agent } from '../core/agent.js';
import type { Memory } from '../memory/memory.js';

export interface SequentialChainOptions {
  agents: Agent[];
  sharedMemory?: Memory;
}

export class SequentialChain {
  readonly agents: Agent[];
  readonly memory?: Memory;

  constructor(opts: SequentialChainOptions) {
    this.agents = opts.agents;
    this.memory = opts.sharedMemory;
  }

  async run(input: string): Promise<string> {
    let output = input;
    for (const agent of this.agents) {
      output = await agent.run(output);
    }
    return output;
  }
}
