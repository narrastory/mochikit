import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SkillRegistry } from '../../src/infra/skill-registry.js';

describe('SkillRegistry', () => {
  let tmpDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `mochikit-skill-test-${Date.now()}`);
    skillsDir = path.join(tmpDir, 'skills');
    await fs.mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createSkill(name: string, dirName: string, desc: string, body: string) {
    const d = path.join(skillsDir, dirName);
    await fs.mkdir(d, { recursive: true });
    const content = `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}`;
    await fs.writeFile(path.join(d, 'SKILL.md'), content, 'utf8');
  }

  it('returns empty list when no skills exist', async () => {
    const reg = new SkillRegistry();
    await reg.scan(skillsDir);
    expect(reg.list()).toBe('');
    expect(reg.size).toBe(0);
  });

  it('scans and lists skills', async () => {
    await createSkill('react-style', 'react-style', 'React conventions', '# Use function components');
    await createSkill('sql-guide', 'sql-guide', 'SQL style guide', '# Use uppercase for keywords');

    const reg = new SkillRegistry();
    await reg.scan(skillsDir);

    expect(reg.size).toBe(2);
    const catalog = reg.list();
    expect(catalog).toContain('react-style');
    expect(catalog).toContain('React conventions');
    expect(catalog).toContain('sql-guide');
  });

  it('loads full skill content', async () => {
    await createSkill('test-skill', 'test-skill', 'Test', '# Body content');

    const reg = new SkillRegistry();
    await reg.scan(skillsDir);

    const content = reg.load('test-skill');
    expect(content).not.toBeNull();
    expect(content).toContain('# Body content');
    expect(content).toContain('name: test-skill');
  });

  it('returns null for unknown skill', async () => {
    const reg = new SkillRegistry();
    await reg.scan(skillsDir);
    expect(reg.load('nonexistent')).toBeNull();
  });

  it('handles non-existent directory gracefully', async () => {
    const reg = new SkillRegistry();
    await reg.scan(path.join(tmpDir, 'nonexistent'));
    expect(reg.size).toBe(0);
  });

  it('uses directory name as fallback when frontmatter has no name', async () => {
    const d = path.join(skillsDir, 'fallback-skill');
    await fs.mkdir(d, { recursive: true });
    // No YAML frontmatter at all
    await fs.writeFile(path.join(d, 'SKILL.md'), '# Just a heading\n\nContent here.', 'utf8');

    const reg = new SkillRegistry();
    await reg.scan(skillsDir);

    expect(reg.size).toBe(1);
    const content = reg.load('fallback-skill');
    expect(content).toContain('Content here');
  });
});
