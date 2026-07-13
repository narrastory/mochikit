/**
 * MessageBus — inter-agent communication via consumable mailboxes
 * (tutorial s15/s16). Messages are appended to an agent's inbox and read
 * destructively (read = consume).
 *
 * ## Design rationale
 *
 * In a multi-agent system, agents need to pass messages to each other
 * (assigning work, reporting results, requesting shutdown). A message bus
 * provides a shared communication channel so agents don't need direct
 * references to each other.
 *
 * ### Consumable mailbox pattern
 *
 * Each agent has its own inbox. When an agent calls {@link MessageBus.readInbox},
 * **all messages are consumed** (removed from the queue). This avoids
 * re-processing the same messages on the next turn. Use {@link MessageBus.peekInbox}
 * to inspect without consuming (useful for status checks).
 *
 * ### FIFO ordering
 *
 * Messages within a single agent's inbox are delivered in insertion order.
 * No ordering guarantees are made across different agents' inboxes.
 *
 * ## Two implementations
 *
 * - {@link InMemoryMessageBus} — a `Map<string, BusMessage[]>` internal
 *   store. Fast, simple, ephemeral. Used in tests and single-process
 *   agent teams where durability is not needed.
 *
 * - {@link FileMessageBus} — persists each agent's inbox as a JSONL file
 *   (`<dir>/<agent>.jsonl`). Survives process restarts. Uses an async
 *   locking mechanism ({@link FileMessageBus.withLock}) to prevent
 *   concurrent reads and writes from corrupting the file.
 *
 * @module message-bus
 */

/**
 * Allowed message types.
 *
 * - `message` — generic text message between agents.
 * - `result` — work result notification.
 * - `shutdown_request` / `shutdown_response` — graceful shutdown handshake.
 * - `plan_approval_request` / `plan_approval_response` — multi-step plan
 *   approval workflow.
 */
export type MessageType =
  | 'message'
  | 'result'
  | 'shutdown_request'
  | 'shutdown_response'
  | 'plan_approval_request'
  | 'plan_approval_response';

/**
 * A single message on the bus.
 *
 * Each message has a sender, recipient, text content, a type tag,
 * a timestamp (set automatically by the bus implementation), and
 * optional metadata for extensibility.
 */
export interface BusMessage {
  /** Sender agent name. */
  from: string;
  /** Recipient agent name. */
  to: string;
  /** Message body (plain text or serialized JSON). */
  content: string;
  /** Semantic type of the message (see {@link MessageType}). */
  type: MessageType;
  /** Unix-epoch-milliseconds timestamp set by the bus on `send()`. */
  ts: number;
  /** Optional key-value metadata (e.g. `{ priority: "high" }`). */
  metadata?: Record<string, unknown>;
}

/**
 * Contract for an inter-agent message bus.
 *
 * Implementations must support:
 * - Destructive read (`readInbox` consumes messages).
 * - Non-destructive peek (`peekInbox` reads without consuming).
 * - Timestamping (the `ts` field is set by the bus, not the caller).
 */
export interface MessageBus {
  /**
   * Send a message to an agent's inbox.
   *
   * The `ts` field is set automatically by the implementation; callers
   * should omit it.
   *
   * @param msg - The message to send (without `ts`).
   */
  send(msg: Omit<BusMessage, 'ts'>): Promise<void>;

  /**
   * Read and consume all messages in an agent's inbox.
   *
   * After this call, the inbox is empty.  Messages are returned in
   * insertion order (oldest first).
   *
   * @param agent - The recipient agent's name.
   * @returns All messages that were in the inbox (empty array if none).
   */
  readInbox(agent: string): Promise<BusMessage[]>;

  /**
   * Read without consuming.
   *
   * Returns a snapshot of the current inbox contents without removing them.
   * Useful for pre-flight checks or status inspection.
   *
   * @param agent - The agent's name whose inbox to inspect.
   * @returns A copy of the messages currently in the inbox.
   */
  peekInbox(agent: string): Promise<BusMessage[]>;
}

/**
 * In-memory message bus with per-agent FIFO queues.
 *
 * ## Characteristics
 *
 * - **Ephemeral** — all data is lost when the process exits.
 * - **Fast** — no I/O, just Map operations.
 * - **Not thread-safe** — designed for single-process, single-event-loop
 *   use (Node.js inherently single-threaded JavaScript, so this is fine).
 *
 * ## Use cases
 *
 * - Unit and integration tests.
 * - Single-process agent teams where durability is not required.
 * - Development and debugging.
 */
export class InMemoryMessageBus implements MessageBus {
  /** Per-agent FIFO queues, keyed by agent name. */
  private inboxes = new Map<string, BusMessage[]>();

  /** @inheritdoc */
  async send(msg: Omit<BusMessage, 'ts'>): Promise<void> {
    const queue = this.inboxes.get(msg.to) ?? [];
    queue.push({ ...msg, ts: Date.now() });
    this.inboxes.set(msg.to, queue);
  }

  /** @inheritdoc */
  async readInbox(agent: string): Promise<BusMessage[]> {
    const queue = this.inboxes.get(agent) ?? [];
    // Destructive read: replace the queue with an empty array.
    this.inboxes.set(agent, []);
    return queue;
  }

  /** @inheritdoc */
  async peekInbox(agent: string): Promise<BusMessage[]> {
    return [...(this.inboxes.get(agent) ?? [])];
  }
}

/**
 * Durable file-backed bus: one JSONL file per agent inbox.
 *
 * ## Persistence model
 *
 * Each agent gets a file at `<dir>/<sanitized-name>.jsonl`.  Messages
 * are appended as JSON lines.  On `readInbox()`, the file is read in
 * full, parsed, and then **deleted** — a destructive read that mirrors
 * the in-memory semantics.
 *
 * ## Concurrency safety
 *
 * Reads and writes to the same agent's inbox are serialized via an
 * async lock ({@link withLock}).  Each agent has its own lock, so
 * messages to different agents can be sent concurrently without
 * blocking each other.
 *
 * The lock is implemented as a chain of chained Promises — each
 * operation waits for the previous one to complete and then signals
 * the next one via a resolver.
 *
 * ## File encoding
 *
 * All files are UTF-8.  Agent names containing characters outside
 * `[A-Za-z0-9_-]` are sanitized (replaced with `_`) to produce safe
 * filenames.
 *
 * ## Use cases
 *
 * - Production multi-agent systems that need to survive restarts.
 * - Scenarios where agents run in separate processes sharing a
 *   filesystem.
 */
export class FileMessageBus implements MessageBus {
  /** Per-agent async locks. Maps agent name → chained Promise. */
  private locks = new Map<string, Promise<void>>();

  /**
   * @param dir - Directory where per-agent JSONL inbox files are stored.
   *              Created recursively on first use if it doesn't exist.
   */
  constructor(private dir: string) {}

  /** @inheritdoc */
  async send(msg: Omit<BusMessage, 'ts'>): Promise<void> {
    await this.withLock(msg.to, async () => {
      const { promises: fs } = await import('node:fs');
      const path = this.inboxPath(msg.to);
      await fs.mkdir(this.dir, { recursive: true });
      const line = JSON.stringify({ ...msg, ts: Date.now() }) + '\n';
      await fs.appendFile(path, line, 'utf8');
    });
  }

  /** @inheritdoc */
  async readInbox(agent: string): Promise<BusMessage[]> {
    return this.withLock(agent, async () => {
      const { promises: fs } = await import('node:fs');
      const path = this.inboxPath(agent);
      try {
        const text = await fs.readFile(path, 'utf8');
        // Destructive read: unlink after reading to prevent double-processing.
        await fs.unlink(path);
        return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as BusMessage);
      } catch {
        // File doesn't exist — no messages.
        return [];
      }
    });
  }

  /** @inheritdoc */
  async peekInbox(agent: string): Promise<BusMessage[]> {
    const { promises: fs } = await import('node:fs');
    try {
      const text = await fs.readFile(this.inboxPath(agent), 'utf8');
      return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as BusMessage);
    } catch {
      return [];
    }
  }

  /**
   * Build the filesystem path for an agent's inbox file.
   *
   * Sanitizes the agent name to prevent path traversal and
   * filesystem-invalid characters.
   *
   * @param agent - Raw agent name.
   * @returns Filesystem path like `<dir>/manager.jsonl`.
   */
  private inboxPath(agent: string): string {
    const safe = agent.replace(/[^A-Za-z0-9_-]/g, '_');
    return `${this.dir}/${safe}.jsonl`;
  }

  /**
   * Serialize operations on a single agent's inbox through an async lock.
   *
   * Locks are per-agent, so operations on different agents run concurrently.
   * The lock is implemented as a chain of Promises:
   *
   * 1. Wait for the previous operation's release Promise.
   * 2. Execute `fn`.
   * 3. Resolve the release Promise so the next waiter can proceed.
   *
   * @param agent - Agent whose inbox is being locked.
   * @param fn - The operation to perform while holding the lock.
   * @returns The return value of `fn`.
   */
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
