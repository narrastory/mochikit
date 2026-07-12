import { describe, it, expect } from 'vitest';
import { assembleSystemPrompt, createPromptCache, defaultPromptSections } from '../../src/core/system-prompt.js';
import type { PromptSection, PromptAssemblyContext } from '../../src/core/system-prompt.js';

const baseCtx: PromptAssemblyContext = {
  workDir: '/tmp/test',
  tools: ['bash', 'read_file'],
  hasMemory: false,
  hasSkills: false,
};

describe('assembleSystemPrompt', () => {
  it('joins unconditional sections', () => {
    const sections: PromptSection[] = [
      { key: 'a', content: 'section-A' },
      { key: 'b', content: 'section-B' },
    ];
    expect(assembleSystemPrompt(sections, baseCtx)).toBe('section-A\n\nsection-B');
  });

  it('skips sections whose condition returns false', () => {
    const sections: PromptSection[] = [
      { key: 'always', content: 'always' },
      { key: 'only-with-memory', content: 'has-memory', condition: (c) => c.hasMemory },
    ];
    expect(assembleSystemPrompt(sections, baseCtx)).toBe('always');
  });

  it('includes sections whose condition returns true', () => {
    const sections: PromptSection[] = [
      { key: 'always', content: 'always' },
      { key: 'only-with-memory', content: 'has-memory', condition: (c) => c.hasMemory },
    ];
    expect(assembleSystemPrompt(sections, { ...baseCtx, hasMemory: true })).toBe('always\n\nhas-memory');
  });

  it('returns empty string for empty sections', () => {
    expect(assembleSystemPrompt([], baseCtx)).toBe('');
  });
});

describe('createPromptCache', () => {
  it('caches identical context', () => {
    const cache = createPromptCache();
    const s: PromptSection[] = [{ key: 'a', content: 'hello' }];
    const r1 = cache.get(baseCtx, s);
    const r2 = cache.get(baseCtx, s);
    expect(r1).toBe(r2);
    expect(r1).toBe('hello');
  });

  it('recomputes when context changes', () => {
    const cache = createPromptCache();
    const s: PromptSection[] = [
      { key: 'a', content: 'base' },
      { key: 'memory', content: 'mem', condition: (c) => c.hasMemory },
    ];
    const r1 = cache.get(baseCtx, s);
    const r2 = cache.get({ ...baseCtx, hasMemory: true }, s);
    expect(r1).not.toBe(r2);
    expect(r2).toBe('base\n\nmem');
  });
});

describe('defaultPromptSections', () => {
  it('includes identity, workspace, tools always', () => {
    const sections = defaultPromptSections({
      identity: 'You are test',
      workDir: '/x',
      tools: 'Tools: bash, read',
    });
    const result = assembleSystemPrompt(sections, baseCtx);
    expect(result).toContain('You are test');
    expect(result).toContain('/x');
    expect(result).toContain('bash');
  });

  it('includes skill catalog when provided', () => {
    const sections = defaultPromptSections({
      identity: 'x',
      workDir: '/',
      tools: '- bash',
      skillCatalog: '- **react**: React style',
    });
    const result = assembleSystemPrompt(sections, baseCtx);
    expect(result).toContain('react');
    expect(result).toContain('Skills available');
  });

  it('excludes memory section when hasMemory is false', () => {
    const sections = defaultPromptSections({
      identity: 'x',
      workDir: '/',
      tools: '- bash',
    });
    const result = assembleSystemPrompt(sections, baseCtx);
    expect(result).not.toContain('Relevant memories');
  });

  it('includes memory section when hasMemory is true', () => {
    const sections = defaultPromptSections({
      identity: 'x',
      workDir: '/',
      tools: '- bash',
    });
    const result = assembleSystemPrompt(sections, { ...baseCtx, hasMemory: true });
    expect(result).toContain('Relevant memories');
  });
});
