/**
 * SkillRegistry — scans a skills/ directory and provides two-level loading
 * (tutorial s07).
 *
 * ## Two-level loading strategy
 *
 * Skills can be large (hundreds or thousands of lines of instructions).
 * Sending all of them in every system prompt would waste context window.
 * Instead, we use a two-phase approach:
 *
 * **Level 1 (cheap — system prompt):** A compact catalog of skill names
 * and one-line descriptions via {@link SkillRegistry.list}.  This tells
 * the model what skills are available without consuming much context.
 *
 * **Level 2 (on-demand — triggered by the model):** When the model decides
 * to use a skill, it calls a `load_skill` tool, which invokes
 * {@link SkillRegistry.load} to fetch the full SKILL.md content.  The
 * full content is then injected into the conversation on that turn.
 *
 * ## Directory layout
 *
 * ```
 * skills/
 *   my-skill/
 *     SKILL.md     # YAML frontmatter (name, description) + markdown body
 *   another-skill/
 *     SKILL.md
 * ```
 *
 * Each subdirectory under `skills/` is a skill.  The directory name is
 * used as the skill name unless the YAML frontmatter specifies a `name`
 * field.
 *
 * ## Initialization
 *
 * Call {@link SkillRegistry.scan} once at startup to populate the registry.
 * Directories without a valid SKILL.md are silently skipped.  If the
 * `skillsDir` does not exist, the registry remains empty (no error thrown).
 *
 * @module skill-registry
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * A single skill entry in the registry.
 *
 * Created by parsing a SKILL.md file: YAML frontmatter provides name and
 * description; the body is the markdown instructions.
 */
export interface SkillEntry {
  /** Skill name (from frontmatter `name` field, or directory basename). */
  name: string;
  /** One-line description (from frontmatter `description`, or first heading / body line). */
  description: string;
  /** Full raw content of the SKILL.md file (frontmatter + body). */
  content: string;
  /** On-disk directory path (for referencing bundled resources like images or scripts). */
  dirPath: string;
}

/**
 * Registry of skills with two-level loading.
 *
 * ## Usage
 *
 * ```ts
 * const registry = new SkillRegistry();
 * await registry.scan('./skills');
 *
 * // Inject into system prompt:
 * const catalog = registry.list();  // compact name+description list
 *
 * // On demand, when the model triggers load_skill:
 * const fullContent = registry.load('my-skill');
 * ```
 *
 * ## Thread safety
 *
 * `scan()` should be called once before any reads.  After scanning,
 * all reads (`list`, `load`, `size`) are synchronous and safe to call
 * from any context.
 */
export class SkillRegistry {
  /** Internal map of skill name → parsed entry. */
  private skills = new Map<string, SkillEntry>();

  /**
   * Scan a directory for skill subdirectories. Call once at startup.
   *
   * Each subdirectory is expected to contain a `SKILL.md` file.  If the
   * file exists and has valid YAML frontmatter, the skill is registered.
   * If the file doesn't exist or can't be parsed, the directory is
   * silently skipped.
   *
   * If `skillsDir` itself doesn't exist, no error is thrown — the registry
   * simply remains empty.
   *
   * @param skillsDir - Path to the skills directory (e.g. `'./skills'`).
   *
   * @example
   * ```ts
   * await registry.scan(path.join(import.meta.dirname, '../skills'));
   * console.log(registry.size); // number of valid skills found
   * ```
   */
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

  /**
   * Return a compact catalog string suitable for the system prompt.
   *
   * Format:
   * ```
   * - **skill-name**: One-line description
   * - **another-skill**: Another description
   * ```
   *
   * Returns an empty string if no skills are registered.
   *
   * @returns A markdown-formatted bullet list of all registered skills.
   */
  list(): string {
    if (this.skills.size === 0) return '';
    const lines: string[] = [];
    for (const s of this.skills.values()) {
      lines.push(`- **${s.name}**: ${s.description}`);
    }
    return lines.join('\n');
  }

  /**
   * Load the full content of a skill by name.
   *
   * Returns the raw SKILL.md content (including frontmatter) so the
   * caller can choose to strip and process it as needed.  This is the
   * "Level 2" (on-demand) load.
   *
   * @param name - Skill name as registered (case-sensitive).
   * @returns The full SKILL.md content, or `null` if the skill is not found.
   */
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

/**
 * Parse a SKILL.md file: extract frontmatter fields + full content.
 *
 * Steps:
 * 1. Parse YAML frontmatter for `name` and `description`.
 * 2. If no `name` in frontmatter, use the directory basename.
 * 3. If no `description` in frontmatter, use the first line of the body
 *    (stripping leading `#` marks).
 * 4. Preserve the full raw content for on-demand loading.
 *
 * @param raw - Raw file content.
 * @param dirPath - Absolute path to the skill's directory.
 * @returns A populated {@link SkillEntry}.
 *
 * @internal
 */
function parseSkillFile(raw: string, dirPath: string): SkillEntry {
  const meta = parseFrontmatter(raw);
  const name = meta.name ?? path.basename(dirPath);
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  const description =
    meta.description ?? body.split('\n')[0]?.replace(/^#+\s*/, '').trim() ?? name;
  return { name, description, content: raw, dirPath };
}

/**
 * Parse YAML frontmatter from a markdown file.
 *
 * Expected format:
 * ```
 * ---
 * key1: value1
 * key2: "quoted value"
 * ---
 * ```
 *
 * Only handles simple `key: value` pairs (no nesting, no lists).
 * Quoted values (`"..."`) have their quotes stripped.
 *
 * @param text - Raw file content.
 * @returns A record of key-value pairs from the frontmatter (empty if none found).
 *
 * @internal
 */
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
