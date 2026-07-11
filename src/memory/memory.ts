/**
 * Memory — the unified memory abstraction (tutorial s09).
 *
 * Implementations store `MemoryEntry` records and expose recall via `query`.
 * The default {@link MarkdownMemory} persists each entry as a Markdown file
 * with YAML frontmatter and maintains a `MEMORY.md` index.
 */

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  id: string;
  name: string;
  type: MemoryType;
  description: string;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export type NewMemoryEntry = Omit<MemoryEntry, 'id' | 'createdAt'>;

export interface Memory {
  add(entry: NewMemoryEntry): Promise<MemoryEntry>;
  get(id: string): Promise<MemoryEntry | null>;
  list(): Promise<MemoryEntry[]>;
  /** Recall up to `k` entries relevant to `needle`. */
  query(needle: string, k?: number): Promise<MemoryEntry[]>;
  update(id: string, patch: Partial<NewMemoryEntry>): Promise<MemoryEntry>;
  remove(id: string): Promise<void>;
}
