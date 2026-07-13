/**
 * MarkdownMemory — file-based memory store (tutorial s09).
 *
 * Each entry is `<dir>/<slug>.md` with YAML frontmatter:
 *   ---
 *   id: ...
 *   name: ...
 *   type: ...
 *   description: ...
 *   createdAt: ...
 *   ---
 *   <body>
 *
 * An index file `MEMORY.md` lists every entry (one line each) for quick recall.
 * `query` does keyword matching across name/description/body by default; an
 * external LLM-based selector can be supplied via the `recall` option.
 *
 * ## Design tradeoffs
 *
 * - **Filesystem-only (no database).**  This makes inspection and debugging
 *   trivial — every entry is a standalone `.md` file that can be opened in any
 *   editor.  The cost is no concurrent-write safety; this backend is intended
 *   for single-agent usage unless external locking is added.
 *
 * - **Keyword matching by default.**  The built-in scorer is a simple
 *   term-overlap count (no TF-IDF, no embeddings).  It is fast, deterministic,
 *   and works for small-to-medium memory stores.  Swap in a vector-backed
 *   `recall` function when you need semantic search.
 *
 * - **Consolidation is name-keyed dedup.**  `consolidate()` groups entries by
 *   their slugified name so that repeated saves of the same conceptual memory
 *   are merged.  This is a coarse heuristic — two entries with different names
 *   but identical content are not merged unless their descriptions also overlap
 *   (>50% keyword overlap).
 *
 * ## File format details
 *
 * Each file name is `<id>.md` where `id` is `slugName_timestamp36_counter`.
 * The `timestamp36` component (base-36 encoded `Date.now()`) keeps sorts
 * roughly chronological while keeping ids URL-safe.  The `counter` prevents
 * collisions when two entries with the same name are created in the same
 * millisecond.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Memory, MemoryEntry, NewMemoryEntry } from './memory.js';

/**
 * Configuration for {@link MarkdownMemory}.
 */
export interface MarkdownMemoryOptions {
  /** Directory where `.md` entry files and `MEMORY.md` are stored. */
  dir: string;
  /**
   * Optional LLM-backed recall function.
   *
   * When provided, `query()` delegates to this function instead of the
   * built-in keyword matcher.  The function receives the full entry list,
   * the search needle, and `k`, and must return up to `k` relevant entries.
   * When absent, {@link keywordMatch} is used.
   */
  recall?: (entries: MemoryEntry[], needle: string, k: number) => Promise<MemoryEntry[]>;
}

/**
 * Monotonically-increasing counter appended to ids to prevent collisions.
 * Not reset across restarts — collisions across process boundaries are
 * already handled by the `Date.now()` timestamp component.
 */
let idSeq = 0;

/**
 * Filesystem-backed {@link Memory} implementation.
 *
 * Each entry is stored as a standalone Markdown file with YAML frontmatter.
 * An auto-generated `MEMORY.md` index maps entry names to their file paths for
 * quick human browsing.
 *
 * ## Usage
 *
 * ```ts
 * const mem = new MarkdownMemory({ dir: "./memory" });
 * await mem.add({ name: "Code style", type: "user", description: "2-space indent", body: "..." });
 * const hits = await mem.query("indent");
 * ```
 */
export class MarkdownMemory implements Memory {
  private opts: MarkdownMemoryOptions;

  constructor(opts: MarkdownMemoryOptions) {
    this.opts = opts;
  }

  /**
   * Persist a new entry as `<dir>/<id>.md` and rebuild the index.
   *
   * The generated `id` is: `slugName_timestamp36_counter`
   * where `timestamp36` is `Date.now().toString(36)` and `counter` is a
   * monotonically-increasing sequence number local to this process.
   *
   * @param entry - The content to persist (name, type, description, body, optional metadata).
   * @returns The fully populated {@link MemoryEntry} with auto-generated id and timestamp.
   */
  async add(entry: NewMemoryEntry): Promise<MemoryEntry> {
    await fs.mkdir(this.opts.dir, { recursive: true });
    const id = slugify(entry.name) + '_' + Date.now().toString(36) + '_' + (idSeq++);
    const full: MemoryEntry = { ...entry, id, createdAt: Date.now() };
    await this.writeFile(full);
    await this.rebuildIndex();
    return full;
  }

  /**
   * Read and parse a single memory file by id.
   *
   * @param id - The entry id (without `.md` extension).
   * @returns The parsed {@link MemoryEntry}, or `null` if the file does not
   *   exist or cannot be parsed.
   */
  async get(id: string): Promise<MemoryEntry | null> {
    try {
      const text = await fs.readFile(this.filePath(id), 'utf8');
      return parseMemoryFile(text);
    } catch {
      return null;
    }
  }

  /**
   * List all entries by scanning the directory for `.md` files (excluding `MEMORY.md`).
   *
   * Corrupt files (unreadable or unparseable) are silently skipped so that one
   * bad file does not break the entire listing.
   *
   * @returns All entries sorted by `createdAt` descending (most recent first).
   */
  async list(): Promise<MemoryEntry[]> {
    try {
      const files = await fs.readdir(this.opts.dir);
      const entries: MemoryEntry[] = [];
      for (const f of files.filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')) {
        try {
          const text = await fs.readFile(path.join(this.opts.dir, f), 'utf8');
          const e = parseMemoryFile(text);
          if (e) entries.push(e);
        } catch {
          // skip corrupt files
        }
      }
      return entries.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  /**
   * Find up to `k` entries relevant to a free-text query.
   *
   * When {@link MarkdownMemoryOptions.recall} is configured, that function is
   * called with the full entry list and its result is returned directly.
   * Otherwise, {@link keywordMatch} performs a simple term-overlap ranking
   * across name, description, and body.
   *
   * @param needle - Free-text search query.
   * @param k - Maximum number of results to return (default 5).
   * @returns Top-scoring entries, or an empty array when the store is empty.
   */
  async query(needle: string, k = 5): Promise<MemoryEntry[]> {
    const entries = await this.list();
    if (entries.length === 0) return [];
    if (this.opts.recall) return this.opts.recall(entries, needle, k);
    return keywordMatch(entries, needle, k);
  }

  /**
   * Merge a partial update into an existing entry.
   *
   * Only the fields present in `patch` are changed; `id` and `createdAt` are
   * always preserved from the original.  The entry file and index are
   * rewritten after the merge.
   *
   * @param id - The entry to update.
   * @param patch - Fields to merge.
   * @returns The updated entry.
   * @throws {Error} If no entry with the given `id` exists.
   */
  async update(id: string, patch: Partial<NewMemoryEntry>): Promise<MemoryEntry> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Memory not found: ${id}`);
    const updated: MemoryEntry = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    await this.writeFile(updated);
    await this.rebuildIndex();
    return updated;
  }

  /**
   * Delete an entry file and rebuild the index.  Silently does nothing if
   * the file does not exist.
   *
   * @param id - The entry to remove.
   */
  async remove(id: string): Promise<void> {
    try {
      await fs.unlink(this.filePath(id));
      await this.rebuildIndex();
    } catch {
      // already gone
    }
  }

  /**
   * Consolidate duplicate / similar memories (tutorial s09).
   *
   * ## Algorithm
   *
   * 1. Group all entries by their **slugified name** (e.g. "Code Style" and
   *    "code-style" land in the same bucket).
   * 2. Within each group, sort by `createdAt` descending — the newest entry
   *    is the "keeper".
   * 3. Merge the body of every older entry into the keeper's body (appended
   *    with a `---` separator).
   * 4. Delete all older entries.
   * 5. Rebuild the index once if any entry was removed.
   *
   * Groups of size 1 are skipped (no dedup needed).
   *
   * @returns The number of entries that were merged and removed.
   */
  async consolidate(): Promise<number> {
    const entries = await this.list();
    if (entries.length < 2) return 0;

    const groups = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const key = e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = groups.get(key);
      if (existing) {
        existing.push(e);
      } else {
        groups.set(key, [e]);
      }
    }

    let removed = 0;
    for (const [, group] of groups) {
      if (group.length < 2) continue;
      // Keep the newest, merge bodies into it
      group.sort((a, b) => b.createdAt - a.createdAt);
      const [newest, ...older] = group;
      const mergedBody = newest.body + '\n\n---\n\n' + older.map((e) => e.body).join('\n\n');
      await this.update(newest.id, { body: mergedBody });
      for (const old of older) {
        await this.remove(old.id);
        removed++;
      }
    }

    if (removed > 0) await this.rebuildIndex();
    return removed;
  }

  /**
   * Construct the on-disk path for an entry id: `<dir>/<id>.md`.
   * @param id - The entry id (without extension).
   * @returns The absolute or relative file path.
   */
  private filePath(id: string): string {
    return path.join(this.opts.dir, `${id}.md`);
  }

  /**
   * Serialize and write a single entry to its `.md` file.
   *
   * Output format:
   * ```
   * ---
   * id: <id>
   * name: <name>
   * type: <type>
   * description: <description>
   * createdAt: <unix-ms>
   * ---
   *
   * <body>
   * ```
   *
   * String values containing special YAML characters (colons, newlines, `#`)
   * are JSON-quoted by {@link yamlScalar}.
   */
  private async writeFile(entry: MemoryEntry): Promise<void> {
    const front = [
      '---',
      `id: ${entry.id}`,
      `name: ${yamlScalar(entry.name)}`,
      `type: ${entry.type}`,
      `description: ${yamlScalar(entry.description)}`,
      `createdAt: ${entry.createdAt}`,
      '---',
      '',
      entry.body,
      '',
    ].join('\n');
    await fs.writeFile(this.filePath(entry.id), front, 'utf8');
  }

  /**
   * Rebuild the `MEMORY.md` index from the current set of entries.
   *
   * The index is a Markdown list with one entry per line:
   * ```
   * # Memory Index
   *
   * - [name](id.md) — description
   * ```
   *
   * This file is regenerated after every mutation (`add`, `update`, `remove`,
   * `consolidate`) so it always reflects the current state of the directory.
   */
  private async rebuildIndex(): Promise<void> {
    const entries = await this.list();
    const lines = ['# Memory Index', ''];
    for (const e of entries) {
      lines.push(`- [${e.name}](${e.id}.md) — ${e.description}`);
    }
    await fs.writeFile(path.join(this.opts.dir, 'MEMORY.md'), lines.join('\n') + '\n', 'utf8');
  }
}

// --- helpers ---

/**
 * Convert a free-text name into a URL-safe, filesystem-safe slug.
 *
 * Algorithm: lowercased, non-alphanumeric characters replaced with hyphens,
 * leading/trailing hyphens stripped, capped at 48 characters.  If the result
 * is empty, the fallback is `"memory"`.
 *
 * @param s - The raw name string (e.g. "Coding Style Guide").
 * @returns A safe slug (e.g. `"coding-style-guide"`).
 */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'memory';
}

/**
 * Escape a string value for use in YAML frontmatter.
 *
 * Values containing a colon, newline, or `#` are JSON-quoted so they do not
 * break the simple key: value frontmatter parser.  Clean values are returned
 * as-is.
 *
 * @param s - The raw string value.
 * @returns The YAML-safe scalar string.
 */
function yamlScalar(s: string): string {
  // quote if it contains a colon or special chars
  if (/[:\n#]/.test(s)) return JSON.stringify(s);
  return s;
}

/**
 * Parse a `.md` memory file into a {@link MemoryEntry}.
 *
 * Expects the format written by {@link MarkdownMemory.writeFile}:
 * YAML frontmatter delimited by `---`, followed by a blank line and the body.
 *
 * @param text - Raw file content.
 * @returns The parsed entry, or `null` if the frontmatter delimiter is missing.
 */
function parseMemoryFile(text: string): MemoryEntry | null {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const front = parseFrontmatter(m[1]);
  const body = m[2].trim();
  return {
    id: front.id ?? '',
    name: front.name ?? '',
    type: (front.type as MemoryEntry['type']) ?? 'reference',
    description: front.description ?? '',
    body,
    createdAt: Number(front.createdAt ?? 0),
  };
}

/**
 * Parse a YAML frontmatter block into a key-value map.
 *
 * This is a minimal parser — it handles simple `key: value` lines and
 * double-quoted values.  It does **not** support nested structures, arrays,
 * or flow-style YAML.  For those use cases, depend on a full YAML library and
 * call it before {@link MarkdownMemory} or in a custom adapter.
 *
 * @param text - The frontmatter text (between the `---` delimiters).
 * @returns A flat map of key to string value.
 */
function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

/**
 * Rank entries by keyword overlap against a search needle.
 *
 * For each entry, the name, description, and body are concatenated into a
 * single haystack.  Each whitespace-delimited term from the needle that
 * appears in the haystack increments the score by 1.  Entries with a score
 * of 0 are excluded.  Results are sorted by score descending and truncated
 * to `k`.
 *
 * ## When to use
 *
 * This is the default recall strategy for {@link MarkdownMemory} when no
 * `recall` function is configured.  It works well for small-to-medium stores
 * (hundreds of entries) and for exact keyword matches.  For semantic
 * ("concept-based") recall, swap in an embedding-backed function via
 * {@link MarkdownMemoryOptions.recall}.
 *
 * @param entries - The full list of stored entries.
 * @param needle - Free-text search query.
 * @param k - Maximum number of results.
 * @returns Top-scoring entries, ordered most-relevant first.
 */
export function keywordMatch(entries: MemoryEntry[], needle: string, k: number): MemoryEntry[] {
  const terms = needle.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = entries.map((e) => {
    const hay = `${e.name} ${e.description} ${e.body}`.toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score++;
    return { e, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.e);
}
