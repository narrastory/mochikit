/**
 * Task tools — create / claim / complete tasks in a TaskStore (tutorial s12).
 *
 * ## DAG task lifecycle
 *
 * These three tools expose the full lifecycle of a dependency-aware task graph:
 *
 * 1. **Create** — A task is born with `status: "pending"` and an optional
 *    `blockedBy` list of prerequisite task IDs.  It cannot start while any
 *    blocker remains incomplete.
 * 2. **Claim** — An agent takes ownership, moving the task to
 *    `status: "in_progress"`.  Claiming fails if the task is still blocked or
 *    already claimed / completed.
 * 3. **Complete** — The task moves to `status: "completed"`.  The store
 *    re-evaluates every pending task that depends on this one and returns any
 *    that are now unblocked, so the agent can decide what to work on next.
 *
 * Tasks are persisted in a {@link TaskStore} (typically
 * {@link InMemoryTaskStore}) and coordinated across agents via the
 * `spawn_teammate` / Manager-Worker collaboration pattern.
 */

import { BaseTool } from '../core/tool.js';
import type { ToolContext } from '../core/tool.js';
import type { TaskStore } from '../infra/task-store.js';

/**
 * Tool that creates a new task in the DAG task graph.
 *
 * A newly-created task has `status: "pending"` and starts with no owner.
 * The optional `blockedBy` array lets callers specify prerequisite task IDs
 * that must be completed before this task becomes claimable.
 */
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

  /**
   * @param tasks - The {@link TaskStore} to create tasks in.
   */
  constructor(private tasks: TaskStore) {
    super();
  }

  /**
   * Create a task with the given subject, description, and optional
   * dependency list.
   *
   * @param input - Raw input from the model.
   *   - `subject` (string, required) — Short title for the task.
   *   - `description` (string, required) — Longer description.
   *   - `blockedBy` (string[], optional) — IDs of prerequisite tasks.
   * @returns A confirmation string containing the new task's ID and subject.
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    const subject = this.requireString(input, 'subject');
    const description = this.requireString(input, 'description');
    const blockedBy = Array.isArray(input.blockedBy) ? (input.blockedBy as string[]) : [];
    const task = await this.tasks.create({ subject, description, blockedBy });
    return `Created task ${task.id}: ${subject}`;
  }
}

/**
 * Tool that claims an unblocked, pending task for the calling agent.
 *
 * Claiming sets `status: "in_progress"` and `owner` to the agent's name.
 * Returns an error string (rather than throwing) if the task cannot be
 * claimed — for example, when it is still blocked, already in progress, or
 * already completed.  This non-throwing behaviour lets the model handle
 * the failure inline without aborting the loop.
 */
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

  /**
   * @param tasks - The {@link TaskStore} to claim tasks from.
   */
  constructor(private tasks: TaskStore) {
    super();
  }

  /**
   * Attempt to claim a task by ID.
   *
   * @param input - Raw input from the model.
   *   - `id` (string, required) — The task ID to claim.
   * @param ctx - Runtime context providing the agent name for ownership.
   * @returns A success message or an error string if the task cannot be claimed.
   */
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

/**
 * Tool that marks a claimed task as completed.
 *
 * Completion transitions the task to `status: "completed"` and triggers a
 * re-evaluation of all pending tasks that list this task as a blocker.  Any
 * newly-unblocked tasks are reported back so the agent can decide whether
 * to claim them next.
 */
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

  /**
   * @param tasks - The {@link TaskStore} to complete tasks in.
   */
  constructor(private tasks: TaskStore) {
    super();
  }

  /**
   * Mark a task as completed and discover newly-unblocked tasks.
   *
   * @param input - Raw input from the model.
   *   - `id` (string, required) — The task ID to complete.
   * @returns A confirmation that includes a comma-separated list of
   *   newly-unblocked task IDs (or "none").
   */
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

/**
 * Factory that creates the full task-tool suite.
 *
 * Returns all three task lifecycle tools wired to the same
 * {@link TaskStore}, so they share a consistent view of the task graph.
 *
 * @param tasks - The {@link TaskStore} instance to back the tools.
 * @returns An array of `[CreateTaskTool, ClaimTaskTool, CompleteTaskTool]`.
 */
export function createTaskTools(tasks: TaskStore): Array<CreateTaskTool | ClaimTaskTool | CompleteTaskTool> {
  return [new CreateTaskTool(tasks), new ClaimTaskTool(tasks), new CompleteTaskTool(tasks)];
}
