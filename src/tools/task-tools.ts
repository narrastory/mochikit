/**
 * Task tools — create / claim / complete tasks in a TaskStore (tutorial s12).
 */

import { BaseTool } from '../core/tool.js';
import type { ToolContext } from '../core/tool.js';
import type { TaskStore } from '../infra/task-store.js';

export class CreateTaskTool extends BaseTool {
  readonly definition = {
    name: 'create_task',
    description: 'Create a task with optional blockedBy dependencies.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        description: { type: 'string' },
        blockedBy: { type: 'array', items: { type: 'string' } },
      },
      required: ['subject', 'description'],
    },
  };

  constructor(private tasks: TaskStore) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const subject = this.requireString(input, 'subject');
    const description = this.requireString(input, 'description');
    const blockedBy = Array.isArray(input.blockedBy) ? (input.blockedBy as string[]) : [];
    const task = await this.tasks.create({ subject, description, blockedBy });
    return `Created task ${task.id}: ${subject}`;
  }
}

export class ClaimTaskTool extends BaseTool {
  readonly definition = {
    name: 'claim_task',
    description: 'Claim a startable (unblocked, pending) task for this agent.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  };

  constructor(private tasks: TaskStore) {
    super();
  }

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const id = this.requireString(input, 'id');
    try {
      const task = await this.tasks.claim(id, ctx.agentName);
      return `Claimed task ${task.id}: ${task.subject}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export class CompleteTaskTool extends BaseTool {
  readonly definition = {
    name: 'complete_task',
    description: 'Mark a task completed and report newly-unblocked tasks.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  };

  constructor(private tasks: TaskStore) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const id = this.requireString(input, 'id');
    try {
      const { task, unblocked } = await this.tasks.complete(id);
      const unblockedNames = unblocked.map((t) => t.id).join(', ') || 'none';
      return `Completed ${task.id}. Unblocked: ${unblockedNames}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export function createTaskTools(tasks: TaskStore): Array<CreateTaskTool | ClaimTaskTool | CompleteTaskTool> {
  return [new CreateTaskTool(tasks), new ClaimTaskTool(tasks), new CompleteTaskTool(tasks)];
}
