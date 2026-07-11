/**
 * MessageBus — inter-agent communication via consumable mailboxes
 * (tutorial s15/s16). Messages are appended to an agent's inbox and read
 * destructively (read = consume).
 *
 * Two implementations: {@link InMemoryMessageBus} (tests / single-process)
 * and {@link FileMessageBus} (durable, JSONL per agent).
 */

export type MessageType =
  | 'message'
  | 'result'
  | 'shutdown_request'
  | 'shutdown_response'
  | 'plan_approval_request'
  | 'plan_approval_response';

export interface BusMessage {
  from: string;
  to: string;
  content: string;
  type: MessageType;
  ts: number;
  metadata?: Record<string, unknown>;
}

export interface MessageBus {
  send(msg: Omit<BusMessage, 'ts'>): Promise<void>;
  /** Read and consume all messages in an agent's inbox. */
  readInbox(agent: string): Promise<BusMessage[]>;
  /** Read without consuming. */
  peekInbox(agent: string): Promise<BusMessage[]>;
}

/** In-memory bus with per-agent FIFO queues. */
export class InMemoryMessageBus implements MessageBus {
  private inboxes = new Map<string, BusMessage[]>();

  async send(msg: Omit<BusMessage, 'ts'>): Promise<void> {
    const queue = this.inboxes.get(msg.to) ?? [];
    queue.push({ ...msg, ts: Date.now() });
    this.inboxes.set(msg.to, queue);
  }

  async readInbox(agent: string): Promise<BusMessage[]> {
    const queue = this.inboxes.get(agent) ?? [];
    this.inboxes.set(agent, []);
    return queue;
  }

  async peekInbox(agent: string): Promise<BusMessage[]> {
    return [...(this.inboxes.get(agent) ?? [])];
  }
}

/** Durable file-backed bus: one JSONL file per agent inbox. */
export class FileMessageBus implements MessageBus {
  private locks = new Map<string, Promise<void>>();

  constructor(private dir: string) {}

  async send(msg: Omit<BusMessage, 'ts'>): Promise<void> {
    await this.withLock(msg.to, async () => {
      const { promises: fs } = await import('node:fs');
      const path = this.inboxPath(msg.to);
      await fs.mkdir(this.dir, { recursive: true });
      const line = JSON.stringify({ ...msg, ts: Date.now() }) + '\n';
      await fs.appendFile(path, line, 'utf8');
    });
  }

  async readInbox(agent: string): Promise<BusMessage[]> {
    return this.withLock(agent, async () => {
      const { promises: fs } = await import('node:fs');
      const path = this.inboxPath(agent);
      try {
        const text = await fs.readFile(path, 'utf8');
        await fs.unlink(path);
        return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as BusMessage);
      } catch {
        return [];
      }
    });
  }

  async peekInbox(agent: string): Promise<BusMessage[]> {
    const { promises: fs } = await import('node:fs');
    try {
      const text = await fs.readFile(this.inboxPath(agent), 'utf8');
      return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as BusMessage);
    } catch {
      return [];
    }
  }

  private inboxPath(agent: string): string {
    const safe = agent.replace(/[^A-Za-z0-9_-]/g, '_');
    return `${this.dir}/${safe}.jsonl`;
  }

  private async withLock<T>(agent: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(agent) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.locks.set(agent, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
