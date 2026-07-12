/**
 * Dynamic system-prompt assembly (tutorial s10).
 *
 * Instead of hard-coding one giant prompt string, define named sections that are
 * assembled at runtime based on active state — which tools are enabled, whether
 * memory is present, which skills are available, etc.
 */

export interface PromptAssemblyContext {
  workDir: string;
  tools: string[];
  hasMemory: boolean;
  hasSkills: boolean;
}

export interface PromptSection {
  key: string;
  content: string;
  /**
   * If provided, the section is only included when this predicate returns true.
   * Omit for sections that should always be present.
   */
  condition?: (ctx: PromptAssemblyContext) => boolean;
}

/** Assemble a system prompt from a list of possibly-conditional sections. */
export function assembleSystemPrompt(
  sections: PromptSection[],
  ctx: PromptAssemblyContext,
): string {
  const parts: string[] = [];
  for (const s of sections) {
    if (!s.condition || s.condition(ctx)) {
      parts.push(s.content);
    }
  }
  return parts.join('\n\n');
}

/** Create a simple prompt cache keyed by serialised context state. */
export function createPromptCache(): {
  get(ctx: PromptAssemblyContext, sections: PromptSection[]): string;
} {
  let lastKey = '';
  let lastResult = '';
  return {
    get(ctx: PromptAssemblyContext, sections: PromptSection[]): string {
      const key = JSON.stringify(ctx, Object.keys(ctx).sort());
      if (key === lastKey && lastResult) return lastResult;
      lastKey = key;
      lastResult = assembleSystemPrompt(sections, ctx);
      return lastResult;
    },
  };
}

/** Pre-built sections that match the tutorial's PROMPT_SECTIONS pattern. */
export function defaultPromptSections(opts: {
  identity: string;
  workDir: string;
  tools: string;
  skillCatalog?: string;
}): PromptSection[] {
  const sections: PromptSection[] = [
    { key: 'identity', content: opts.identity },
    {
      key: 'workspace',
      content: `Working directory: ${opts.workDir}`,
    },
    {
      key: 'tools',
      content: opts.tools,
    },
  ];
  if (opts.skillCatalog) {
    sections.push({
      key: 'skills',
      content: `Skills available (use load_skill to get full details):\n${opts.skillCatalog}`,
    });
  }
  sections.push({
    key: 'memory',
    content: 'Relevant memories are injected below when available. Respect user preferences from memory.',
    condition: (ctx) => ctx.hasMemory,
  });
  return sections;
}
