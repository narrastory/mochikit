/**
 * Memory — the unified memory abstraction (tutorial s09).
 *
 * Implementations store {@link MemoryEntry} records and expose recall via `query`.
 * The default {@link MarkdownMemory} persists each entry as a Markdown file
 * with YAML frontmatter and maintains a `MEMORY.md` index.
 *
 * ## Design
 *
 * `Memory` is a simple CRUD interface with a semantic `query` method — the
 * agent records facts, observations, and decisions during a conversation, then
 * later retrieves relevant entries to ground future turns.  The interface is
 * deliberately generic so backends can range from a local markdown directory
 * ({@link MarkdownMemory}) all the way to a vector database behind
 * {@link VectorStore}.
 *
 * ## Entry lifecycle
 *
 * Callers construct a {@link NewMemoryEntry} (no id / createdAt) and call
 * `add()`, which returns an {@link MemoryEntry} with auto-generated metadata.
 * Updates use a {@link Partial<NewMemoryEntry>} patch — `id` and `createdAt`
 * are preserved from the original record.
 */

/**
 * Classification tag attached to every memory entry.
 *
 * The type drives how the agent interprets the entry at recall time:
 * - `'user'` — explicit user preference or instruction ("always use 2-space indent")
 * - `'feedback'` — agent self-reflection or human correction ("that answer was too verbose")
 * - `'project'` — fact about the current codebase or task context
 * - `'reference'` — general knowledge the agent saved for later reuse
 */
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

/**
 * A persisted memory record with auto-generated identity and timestamp.
 *
 * Each entry is stored as a standalone document; the `name` + `description`
 * pair serves as a human-readable summary, while `body` holds the full content.
 */
export interface MemoryEntry {
  /** Unique, auto-generated identifier (slug_timestamp_counter). */
  id: string;
  /** Short human-readable title used in indexes and keyword matching. */
  name: string;
  /** Semantic classification tag — see {@link MemoryType}. */
  type: MemoryType;
  /** One-line summary displayed in the `MEMORY.md` index and used during keyword matching. */
  description: string;
  /** Full markdown body — the actual content the agent will read at recall time. */
  body: string;
  /** Optional key-value bag for backend-specific filtering (e.g. vector metadata). */
  metadata?: Record<string, unknown>;
  /** Unix-epoch-millis timestamp set automatically on `add()`. */
  createdAt: number;
}

/**
 * Input type for `Memory.add()` — omits the server-generated fields.
 *
 * Separating {@link NewMemoryEntry} from {@link MemoryEntry} prevents callers
 * from accidentally providing an `id` or `createdAt` that would be overwritten.
 */
export type NewMemoryEntry = Omit<MemoryEntry, 'id' | 'createdAt'>;

/**
 * The memory contract — every memory backend must satisfy this interface.
 *
 * Implementations must handle concurrent access gracefully.  The default
 * {@link MarkdownMemory} uses the filesystem directly (no locking), so it is
 * safe for single-agent use but may need external coordination in multi-agent
 * setups.
 */
export interface Memory {
  /**
   * Persist a new entry and return it with auto-generated `id` and `createdAt`.
   * @param entry - The content to store (name, type, description, body, optional metadata).
   * @returns The fully-populated {@link MemoryEntry} with server-assigned identity.
   */
  add(entry: NewMemoryEntry): Promise<MemoryEntry>;

  /**
   * Retrieve a single entry by its unique id.
   * @param id - The `id` field returned by `add()` or `list()`.
   * @returns The entry, or `null` if no entry with that id exists.
   */
  get(id: string): Promise<MemoryEntry | null>;

  /**
   * List every stored entry, most-recent-first.
   * @returns All entries sorted by `createdAt` descending.
   */
  list(): Promise<MemoryEntry[]>;

  /**
   * Recall up to `k` entries relevant to `needle`.
   *
   * The default implementation uses keyword matching across name, description,
   * and body.  Backends may override this with embedding-based semantic search.
   *
   * @param needle - A free-text query string (e.g. "coding style preferences").
   * @param k - Maximum number of entries to return (default 5).
   * @returns Top-scoring entries ordered by relevance, or an empty array when the store is empty.
   */
  query(needle: string, k?: number): Promise<MemoryEntry[]>;

  /**
   * Patch an existing entry.  Only the fields present in `patch` are changed;
   * `id` and `createdAt` are always preserved from the original.
   *
   * @param id - The entry to update.
   * @param patch - Partial fields to merge (name, type, description, body, metadata).
   * @returns The updated entry.
   * @throws Error if no entry with the given `id` exists.
   */
  update(id: string, patch: Partial<NewMemoryEntry>): Promise<MemoryEntry>;

  /**
   * Delete an entry by id.  Silently succeeds if the id does not exist.
   * @param id - The entry to remove.
   */
  remove(id: string): Promise<void>;
}
