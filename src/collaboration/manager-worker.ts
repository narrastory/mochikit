/**
 * Manager-Worker collaboration (tutorial s06 / s15).
 *
 * The manager agent is given a `spawn_teammate` tool bound to a registry of
 * worker agents. Delegation runs each worker in an isolated context and
 * returns only a summary.
 */

import type { Agent } from '../core/agent.js';
import { SpawnSubagentTool } from './subagent.js';

export interface WorkerSpec {
  name: string;
  agent: Agent;
}

export interface ManagerWorkerOptions {
  manager: Agent;
  workers: WorkerSpec[];
}

export class ManagerWorker {
  readonly manager: Agent;
  readonly workers = new Map<string, Agent>();

  constructor(opts: ManagerWorkerOptions) {
    this.manager = opts.manager;
    for (const w of opts.workers) this.workers.set(w.name, w.agent);
    // Equip the manager with the delegation tool.
    this.manager.registerTool(new SpawnSubagentTool(this.workers));
  }

  /** Run the manager; it may delegate to workers as needed. */
  async run(input: string): Promise<string> {
    return this.manager.run(input);
  }
}
