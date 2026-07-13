/**
 * TaskStore — a dependency-aware task graph (tutorial s12).
 *
 * ## DAG task model
 *
 * Each task has a `blockedBy` array listing task IDs that must complete
 * before this task can start.  This creates a **directed acyclic graph**
 * of dependencies.  There is no explicit cycle detection — callers are
 * responsible for ensuring the dependency graph is acyclic.
 *
 * ## Lifecycle
 *
 * ```
 * pending ──claim()──> in_progress ──complete()──> completed
 * ```
 *
 * 1. **pending** — created, waiting for dependencies to be satisfied.
 * 2. **in_progress** — claimed by an agent, actively being worked on.
 * 3. **completed** — finished; any tasks blocked on this one are now unblocked.
 *
 * ## canStart / claim / complete workflow
 *
 * The typical flow:
 *
 * 1. Call {@link TaskStore.canStart} to check if all blockers are completed.
 * 2. Call {@link TaskStore.claim} to take ownership (atomically checks `canStart` again).
 * 3. Do the work.
 * 4. Call {@link TaskStore.complete} to mark done and discover newly-unblocked tasks.
 *
 * ## Unblocking
 *
 * When {@link TaskStore.complete} finishes a task, it scans all other tasks
 * to find ones that were blocked on the completed task and are now
 * unblocked (because all their other dependencies are also complete).
 * These are returned as the `unblocked` array so the caller can queue them.
 *
 * @module task-store
 */

/**
 * Task lifecycle status.
 *
 * - `pending` — created but not yet ready (may be blocked on dependencies).
 * - `in_progress` — claimed by an agent and being worked on.
 * - `completed` — finished successfully.
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

/**
 * A single node in the task dependency graph.
 *
 * Tasks form a DAG via the `blockedBy` field.  A task cannot start until
 * every task in its `blockedBy` list is `completed`.
 */
export interface Task {
  /** Unique task identifier (auto-generated if not provided). */
  id: string;
  /** Short subject line describing the task. */
  subject: string;
  /** Detailed description of the work to be done. */
  description: string;
  /** Current lifecycle status. */
  status: TaskStatus;
  /** Agent that claimed this task, or `null` if unclaimed. */
  owner: string | null;
  /** IDs of tasks that must complete before this one can start. */
  blockedBy: string[];
  /** Unix-epoch-milliseconds timestamp of creation. */
  createdAt: number;
}

/**
 * Contract for a task graph store.
 *
 * Implementations must handle:
 * - Task creation with auto-generated IDs.
 * - Dependency-aware readiness checks (`canStart`).
 * - Atomic claim (prevents double-claiming).
 * - Completion with automatic unblocking of dependents.
 */
export interface TaskStore {
  /**
   * Create a new task in `pending` status.
   *
   * If no `id` is provided, one is auto-generated.  The `status` is
   * always set to `'pending'` and `owner` to `null`.
   *
   * @param task - Task definition (without auto-populated fields).
   * @returns The newly created task with populated id/status/owner/createdAt.
   * @throws {Error} If a task with the given `id` already exists.
   */
  create(task: Omit<Task, 'id' | 'status' | 'owner' | 'createdAt'> & { id?: string }): Promise<Task>;

  /**
   * Retrieve a task by ID.
   *
   * @param id - Task identifier.
   * @returns The task, or `null` if not found.
   */
  get(id: string): Promise<Task | null>;

  /**
   * List all tasks in the store.
   *
   * @returns All tasks (no ordering guarantee unless the implementation
   *          adds one).
   */
  list(): Promise<Task[]>;

  /**
   * Check whether a task is ready to start.
   *
   * A task is ready when:
   * - It exists.
   * - Its status is `'pending'`.
   * - Every task in its `blockedBy` array has status `'completed'`.
   *
   * @param id - Task identifier.
   * @returns `true` if the task's dependencies are all satisfied.
   */
  canStart(id: string): Promise<boolean>;

  /**
   * Claim a task for an agent.
   *
   * Sets status to `'in_progress'` and owner to the claiming agent.
   * Fails if the task is not ready to start (blocked or already claimed).
   *
   * @param id - Task identifier.
   * @param agent - Name of the claiming agent.
   * @returns The updated task.
   *
   * @throws {Error} If the task is not found.
   * @throws {Error} If the task cannot start (blocked or not pending).
   */
  claim(id: string, agent: string): Promise<Task>;

  /**
   * Mark a task as completed and discover newly-unblocked tasks.
   *
   * After completion, scans all other `pending` tasks to find those
   * that were blocked on this task and are now fully unblocked.
   *
   * @param id - Task identifier.
   * @returns The completed task and an array of newly-unblocked tasks.
   *
   * @throws {Error} If the task is not found.
   */
  complete(id: string): Promise<{ task: Task; unblocked: Task[] }>;

  /**
   * Remove a task from the store entirely.
   *
   * **Warning:** Does not update dependent tasks' `blockedBy` arrays.
   * Removing a task that other tasks depend on will orphan those
   * dependencies and may cause them to become permanently blocked.
   *
   * @param id - Task identifier.
   */
  remove(id: string): Promise<void>;
}

/** @internal Global counter for generating unique task IDs. */
let idCounter = 0;

/**
 * Generate a unique task ID.
 *
 * Format: `{prefix}_{base36-timestamp}_{counter}`
 *
 * @param prefix - Human-readable prefix (e.g. `'task'`).
 * @returns A unique ID string.
 *
 * @internal
 */
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/**
 * In-memory implementation of {@link TaskStore}.
 *
 * ## Characteristics
 *
 * - **Ephemeral** — all data is lost on process exit.
 * - **Fast** — pure Map operations, no serialization overhead.
 * - **Single-process** — no concurrency control beyond async/await.
 *
 * ## Unblocking algorithm
 *
 * On {@link complete}, the implementation iterates all tasks to find
 * `pending` tasks whose `blockedBy` includes the completed task ID,
 * then re-checks `canStart` for each candidate.  This is O(n) per
 * completion.  For task graphs with hundreds of tasks, consider a
 * more efficient implementation that maintains reverse-dependency
 * indices.
 */
export class InMemoryTaskStore implements TaskStore {
  /** Internal task storage, keyed by task ID. */
  private tasks = new Map<string, Task>();

  /** @inheritdoc */
  async create(task: Omit<Task, 'id' | 'status' | 'owner' | 'createdAt'> & { id?: string }): Promise<Task> {
    const id = task.id ?? nextId('task');
    if (this.tasks.has(id)) throw new Error(`Task already exists: ${id}`);
    const full: Task = {
      id,
      subject: task.subject,
      description: task.description,
      blockedBy: task.blockedBy,
      status: 'pending',
      owner: null,
      createdAt: Date.now(),
    };
    this.tasks.set(id, full);
    return full;
  }

  /** @inheritdoc */
  async get(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  /** @inheritdoc */
  async list(): Promise<Task[]> {
    return [...this.tasks.values()];
  }

  /** @inheritdoc */
  async canStart(id: string): Promise<boolean> {
    const t = this.tasks.get(id);
    if (!t) return false;
    if (t.status !== 'pending') return false;
    for (const dep of t.blockedBy) {
      const d = this.tasks.get(dep);
      if (!d || d.status !== 'completed') return false;
    }
    return true;
  }

  /** @inheritdoc */
  async claim(id: string, agent: string): Promise<Task> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    if (!(await this.canStart(id))) {
      throw new Error(`Task ${id} cannot start (blocked or not pending)`);
    }
    t.status = 'in_progress';
    t.owner = agent;
    return t;
  }

  /** @inheritdoc */
  async complete(id: string): Promise<{ task: Task; unblocked: Task[] }> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    t.status = 'completed';
    const unblocked: Task[] = [];
    // Scan for tasks that were blocked on this one and are now unblocked.
    for (const other of this.tasks.values()) {
      if (other.status === 'pending' && other.blockedBy.includes(id)) {
        if (await this.canStart(other.id)) unblocked.push(other);
      }
    }
    return { task: t, unblocked };
  }

  /** @inheritdoc */
  async remove(id: string): Promise<void> {
    this.tasks.delete(id);
  }
}
