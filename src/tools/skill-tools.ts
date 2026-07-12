/**
 * Skill tools — `list_skills` and `load_skill` backed by a SkillRegistry
 * (tutorial s07).
 */

import { BaseTool } from '../core/tool.js';
import type { SkillRegistry } from '../infra/skill-registry.js';

export class ListSkillsTool extends BaseTool {
  readonly definition = {
    name: 'list_skills',
    description: 'List available skills with brief descriptions.',
    input_schema: { type: 'object', properties: {} },
  };

  constructor(private registry: SkillRegistry) {
    super();
  }

  async execute(): Promise<string> {
    const catalog = this.registry.list();
    if (!catalog) return 'No skills available.';
    return `Available skills:\n${catalog}`;
  }
}

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

  constructor(private registry: SkillRegistry) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const name = this.requireString(input, 'name');
    const content = this.registry.load(name);
    if (content === null) return `Skill not found: "${name}". Use list_skills to see what is available.`;
    return content;
  }
}

export function createSkillTools(
  registry: SkillRegistry,
): Array<ListSkillsTool | LoadSkillTool> {
  return [new ListSkillsTool(registry), new LoadSkillTool(registry)];
}
