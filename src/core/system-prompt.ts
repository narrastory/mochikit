/**
 * Dynamic system-prompt assembly (tutorial s10).
 *
 * Instead of hard-coding one giant prompt string, define named sections that are
 * assembled at runtime based on active state — which tools are enabled, whether
 * memory is present, which skills are available, etc.
 *
 * ## When dynamic sections replace vs. supplement the static system prompt
 *
 * {@link defaultPromptSections} builds a baseline prompt from identity,
 * workspace path, tool list, and an optional skill catalog.  Sections marked
 * with a `condition` (such as the memory section that only activates when
 * `hasMemory` is `true`) are **supplementary** — they are appended to the
 * assembled prompt when the condition passes.  Sections without a condition
 * are always included and form the **static** portion of the prompt.
 *
 * If you need to **replace** the default static prompt entirely, construct
 * your own `PromptSection[]` array from scratch and pass it to
 * {@link assembleSystemPrompt} — the assembler has no notion of a "base"
 * prompt; it simply concatenates every section whose condition is met.
 */

/** Context snapshot used to decide which prompt sections to include. */
export interface PromptAssemblyContext {
  /** Absolute path to the agent's working directory. */
  workDir: string;
  /** List of tool names currently available to the agent. */
  tools: string[];
  /** Whether a {@link Memory} backend is attached to the agent. */
  hasMemory: boolean;
  /** Whether at least one skill is registered (e.g. via {@link PluginBuilder}). */
  hasSkills: boolean;
}

/**
 * A named chunk of prompt text that may be conditionally included.
 *
 * Sections are the building blocks of dynamic prompt assembly.  Each section
 * has a unique {@link key} for caching/debugging, a {@link content} string,
 * and an optional {@link condition} predicate that gates inclusion at runtime.
 */
export interface PromptSection {
  /** Unique key used for caching and debugging. */
  key: string;
  /** The literal prompt text contributed by this section. */
  content: string;
  /**
   * If provided, the section is only included when this predicate returns true.
   * Omit for sections that should always be present.
   */
  condition?: (ctx: PromptAssemblyContext) => boolean;
}

/**
 * Assemble a system prompt from a list of possibly-conditional sections.
 *
 * Iterates the `sections` array and joins every section whose
 * {@link PromptSection.condition} is absent or returns `true` for the given
 * context.  Sections are joined with double-newline separators.
 *
 * @param sections - Ordered array of prompt sections to evaluate.
 * @param ctx - The current assembly context (tools, memory, skills, etc.).
 * @returns The assembled system prompt string.
 */
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

/**
 * Create a simple prompt cache keyed by serialised context state.
 *
 * The returned object holds a single slot.  Repeated calls with deep-equal
 * context (via `JSON.stringify`) skip re-assembly and return the cached
 * result immediately.  This is useful during agent loops where the set of
 * active tools and skills rarely changes between turns.
 *
 * @returns An object with a `get` method that accepts the context and sections,
 *          returning the cached or freshly assembled prompt string.
 */
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

/**
 * Pre-built sections that match the tutorial's PROMPT_SECTIONS pattern.
 *
 * Produces sections for identity, workspace directory, tool list, and
 * optionally a skill catalog.  A conditional "memory" section is always
 * appended but only activates when `hasMemory` is `true` in the context.
 *
 * @param opts - Configuration object for the default sections.
 * @param opts.identity - A short string identifying the agent (e.g. its role name).
 * @param opts.workDir - Absolute path to the agent's working directory.
 * @param opts.tools - Pre-formatted tool list string (names with descriptions).
 * @param opts.skillCatalog - Optional skill listing injected as a "skills" section.
 * @returns An array of {@link PromptSection} ready for {@link assembleSystemPrompt}.
 */
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
