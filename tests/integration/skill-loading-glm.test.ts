import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { Agent, PermissionManager, AllowAllResolver, SkillRegistry } from '../../src/index.js';
import { createSkillTools } from '../../src/tools/skill-tools.js';
import { glmClient, MODEL, runIntegration } from './helpers.js';

describe.skipIf(!runIntegration)('Skill Loading — real GLM', () => {
  it('agent can list and load skills', async () => {
    const skillsDir = path.resolve(process.cwd(), 'skills');
    const registry = new SkillRegistry();
    await registry.scan(skillsDir);

    const agent = new Agent({
      name: 'skill-tester',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You have access to skills. Use list_skills to see what is available,' +
        ' then use load_skill to read one. Mention the skill name in your response.' +
        ' Be concise.',
      tools: createSkillTools(registry),
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 4,
    });

    const result = await agent.run(
      'List the available skills and load the "react-style" skill.' +
      ' Tell me what conventions it recommends.',
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
    // Should contain React-related content from the loaded skill
    console.log('[skill-loading] output:', result.slice(0, 400));
  }, 120_000);

  it('agent handles unknown skill gracefully', async () => {
    const skillsDir = path.resolve(process.cwd(), 'skills');
    const registry = new SkillRegistry();
    await registry.scan(skillsDir);

    const agent = new Agent({
      name: 'skill-fallback',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'Use load_skill to try loading a non-existent skill called "nonexistent-skill".' +
        ' The tool should tell you it is not found. Be concise.',
      tools: createSkillTools(registry),
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 2,
    });

    const result = await agent.run('Try to load the skill "nonexistent-skill".');
    expect(result.length).toBeGreaterThan(5);
    console.log('[skill-fallback] output:', result.slice(0, 200));
  }, 120_000);
});
