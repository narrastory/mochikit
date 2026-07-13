/**
 * Skill tools — `list_skills` and `load_skill` backed by a SkillRegistry
 * (tutorial s07).
 *
 * ## Two-level skill loading pattern
 *
 * Skills are loaded in two stages to minimise prompt bloat:
 *
 * 1. **Catalog (cheap)** — At startup, {@link SkillRegistry.scan} discovers
 *    all skill directories and builds a compact listing of names and
 *    one-line descriptions.  This catalog is injected into the system
 *    prompt so the model is aware of all available skills without
 *    consuming significant context window space.
 * 2. **Full content (on demand)** — When the model actually needs a skill,
 *    it calls `load_skill` by name.  The registry returns the complete
 *    `SKILL.md` content (frontmatter + body), which the model can then
 *    follow as instructions.
 *
 * This two-tier approach keeps the system prompt lean while still giving
 * the agent access to arbitrarily detailed skill instructions.
 */

import { BaseTool } from '../core/tool.js';
import type { SkillRegistry } from '../infra/skill-registry.js';

/**
 * Tool that lists all available skills from the {@link SkillRegistry}.
 *
 * This is the **catalog** half of the two-level loading pattern.  It
 * returns a compact listing suitable for browsing — one line per skill
 * with its name and description.  The model can then decide which skill
 * to load using {@link LoadSkillTool}.
 */
export class ListSkillsTool extends BaseTool {
  readonly definition = {
    name: 'list_skills',
    description: 'List available skills with brief descriptions.',
    input_schema: { type: 'object', properties: {} },
  };

  /**
   * @param registry - The {@link SkillRegistry} to query for available
   *   skills.
   */
  constructor(private registry: SkillRegistry) {
    super();
  }

  /**
   * Return a compact catalog of all registered skills.
   *
   * @returns A newline-separated, markdown-formatted list of skill names
   *   and descriptions, or `"No skills available."` if the registry is
   *   empty.
   */
  async execute(): Promise<string> {
    const catalog = this.registry.list();
    if (!catalog) return 'No skills available.';
    return `Available skills:\n${catalog}`;
  }
}

/**
 * Tool that loads the full content of a skill by name.
 *
 * This is the **on-demand** half of the two-level loading pattern.  After
 * discovering a skill via {@link ListSkillsTool}, the model calls this
 * tool with the skill name to retrieve the complete `SKILL.md` content.
 * The returned text includes both the YAML frontmatter and the markdown
 * body, giving the model the full instruction set for that skill.
 */
export class LoadSkillTool extends BaseTool {
  readonly definition = {
    name: 'load_skill',
    description: 'Load the full content of a skill by name.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
  };

  /**
   * @param registry - The {@link SkillRegistry} to load skill content
   *   from.
   */
  constructor(private registry: SkillRegistry) {
    super();
  }

  /**
   * Load the full `SKILL.md` content for a named skill.
   *
   * @param input - Raw input from the model.
   *   - `name` (string, required) — The skill name (must match exactly
   *     as listed by `list_skills`).
   * @returns The complete skill content (YAML frontmatter + markdown
   *   body), or a `"Skill not found"` message advising the model to use
   *   `list_skills`.
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    const name = this.requireString(input, 'name');
    const content = this.registry.load(name);
    if (content === null) return `Skill not found: "${name}". Use list_skills to see what is available.`;
    return content;
  }
}

/**
 * Factory that creates the skill tool suite.
 *
 * Both tools share the same {@link SkillRegistry}, which was populated
 * at startup by {@link SkillRegistry.scan}.
 *
 * @param registry - The {@link SkillRegistry} to back both tools.
 * @returns An array of `[ListSkillsTool, LoadSkillTool]`.
 */
export function createSkillTools(
  registry: SkillRegistry,
): Array<ListSkillsTool | LoadSkillTool> {
  return [new ListSkillsTool(registry), new LoadSkillTool(registry)];
}
