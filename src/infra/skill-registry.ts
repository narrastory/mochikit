/**
 * SkillRegistry — scans a skills/ directory and provides two-level loading
 * (tutorial s07).
 *
 * Level 1 (cheap): a compact directory listing injected into the system prompt.
 * Level 2 (on-demand): the full SKILL.md content loaded via `load_skill`.
 *
 * Directory layout:
 *   skills/
 *     my-skill/
 *       SKILL.md     # YAML frontmatter (name, description) + markdown body
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface SkillEntry {
  name: string;
  description: string;
  /** Full raw content of the SKILL.md file (frontmatter + body). */
  content: string;
  /** On-disk directory path (for referencing bundled resources). */
  dirPath: string;
}

export class SkillRegistry {
  private skills = new Map<string, SkillEntry>();

  /** Scan a directory for skill subdirectories. Call once at startup. */
  async scan(skillsDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const d of entries) {
        if (!d.isDirectory()) continue;
        const manifestPath = path.join(skillsDir, d.name, 'SKILL.md');
        try {
          const raw = await fs.readFile(manifestPath, 'utf8');
          const entry = parseSkillFile(raw, path.join(skillsDir, d.name));
          this.skills.set(entry.name, entry);
        } catch {
          // skip directories without a valid SKILL.md
        }
      }
    } catch {
      // skillsDir doesn't exist — no skills registered
    }
  }

  /** Return a compact catalog string suitable for the system prompt. */
  list(): string {
    if (this.skills.size === 0) return '';
    const lines: string[] = [];
    for (const s of this.skills.values()) {
      lines.push(`- **${s.name}**: ${s.description}`);
    }
    return lines.join('\n');
  }

  /** Load the full content of a skill by name. */
  load(name: string): string | null {
    const entry = this.skills.get(name);
    if (!entry) return null;
    return entry.content;
  }

  /** Number of registered skills. */
  get size(): number {
    return this.skills.size;
  }
}

/** Parse a SKILL.md file: extract frontmatter fields + full content. */
function parseSkillFile(raw: string, dirPath: string): SkillEntry {
  const meta = parseFrontmatter(raw);
  const name = meta.name ?? path.basename(dirPath);
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  const description =
    meta.description ?? body.split('\n')[0]?.replace(/^#+\s*/, '').trim() ?? name;
  return { name, description, content: raw, dirPath };
}

function parseFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith('---')) return {};
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}
