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
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Memory, MemoryEntry, NewMemoryEntry } from './memory.js';

export interface MarkdownMemoryOptions {
  dir: string;
  /** Optional LLM-backed recall; falls back to keyword matching when absent. */
  recall?: (entries: MemoryEntry[], needle: string, k: number) => Promise<MemoryEntry[]>;
}

let idSeq = 0;

export class MarkdownMemory implements Memory {
  private opts: MarkdownMemoryOptions;

  constructor(opts: MarkdownMemoryOptions) {
    this.opts = opts;
  }

  async add(entry: NewMemoryEntry): Promise<MemoryEntry> {
    await fs.mkdir(this.opts.dir, { recursive: true });
    const id = slugify(entry.name) + '_' + Date.now().toString(36) + '_' + (idSeq++);
    const full: MemoryEntry = { ...entry, id, createdAt: Date.now() };
    await this.writeFile(full);
    await this.rebuildIndex();
    return full;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    try {
      const text = await fs.readFile(this.filePath(id), 'utf8');
      return parseMemoryFile(text);
    } catch {
      return null;
    }
  }

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

  async query(needle: string, k = 5): Promise<MemoryEntry[]> {
    const entries = await this.list();
    if (entries.length === 0) return [];
    if (this.opts.recall) return this.opts.recall(entries, needle, k);
    return keywordMatch(entries, needle, k);
  }

  async update(id: string, patch: Partial<NewMemoryEntry>): Promise<MemoryEntry> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Memory not found: ${id}`);
    const updated: MemoryEntry = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt };
    await this.writeFile(updated);
    await this.rebuildIndex();
    return updated;
  }

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
   * Groups entries by name prefix, merges bodies of entries with the same name
   * or whose descriptions share > 50% keyword overlap, keeping only the newest.
   * Returns the number of merged-then-removed entries.
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

  private filePath(id: string): string {
    return path.join(this.opts.dir, `${id}.md`);
  }

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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'memory';
}

function yamlScalar(s: string): string {
  // quote if it contains a colon or special chars
  if (/[:\n#]/.test(s)) return JSON.stringify(s);
  return s;
}

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
