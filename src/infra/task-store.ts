/**
 * TaskStore — a dependency-aware task graph (tutorial s12).
 *
 * Tasks have `blockedBy` dependencies; {@link canStart} is true only when all
 * blockers are completed. Supports claiming (ownership) and completion, with
 * notification of newly-unblocked tasks.
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface Task {
  id: string;
  subject: string;
  description: string;
  status: TaskStatus;
  owner: string | null;
  blockedBy: string[];
  createdAt: number;
}

export interface TaskStore {
  create(task: Omit<Task, 'id' | 'status' | 'owner' | 'createdAt'> & { id?: string }): Promise<Task>;
  get(id: string): Promise<Task | null>;
  list(): Promise<Task[]>;
  canStart(id: string): Promise<boolean>;
  claim(id: string, agent: string): Promise<Task>;
  complete(id: string): Promise<{ task: Task; unblocked: Task[] }>;
  remove(id: string): Promise<void>;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export class InMemoryTaskStore implements TaskStore {
  private tasks = new Map<string, Task>();

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

  async get(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async list(): Promise<Task[]> {
    return [...this.tasks.values()];
  }

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

  async complete(id: string): Promise<{ task: Task; unblocked: Task[] }> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`Task not found: ${id}`);
    t.status = 'completed';
    const unblocked: Task[] = [];
    for (const other of this.tasks.values()) {
      if (other.status === 'pending' && other.blockedBy.includes(id)) {
        if (await this.canStart(other.id)) unblocked.push(other);
      }
    }
    return { task: t, unblocked };
  }

  async remove(id: string): Promise<void> {
    this.tasks.delete(id);
  }
}
