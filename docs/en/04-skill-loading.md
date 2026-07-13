# 04 - Skill Loading System

In this chapter you'll learn: how to extend an Agent's knowledge using declarative SKILL.md files, loaded on demand to avoid wasting tokens.

## Plugin vs. Skill

| | Plugin | Skill |
|---|---|---|
| Nature | TypeScript code (tools + hooks + rules) | Declarative Markdown file |
| Load Timing | At code installation time | Model calls `load_skill` on demand |
| Purpose | Extend Agent capabilities | Inject project conventions, style guides, domain knowledge |
| Cost | No context overhead (tool definitions always present) | Directory ~100 tokens/skill, content ~2000 |

## Directory Structure

```
skills/
  react-style/
    SKILL.md
  sql-guide/
    SKILL.md
  api-design/
    SKILL.md
```

## SKILL.md Format

```markdown
---
name: react-style
description: React component style conventions
---

# React Component Conventions

- Use function components + Hooks
- One component per file
- ...
```

## Installing Into an Agent

```ts
import { Agent, SkillRegistry, createSkillTools } from 'mochikit';

const skills = new SkillRegistry();
await skills.scan('./skills');

const agent = new Agent({
  name: 'skilled-agent',
  // ...
  skillsDir: './skills',
  tools: createSkillTools(skills),
});

await agent.init(); // Scans the skills/ directory
```

Once started, the model sees the skill directory listing in the system prompt (low token cost), and calls `load_skill('react-style')` when it needs the full content. Child agents do not inherit skills by default.

Next chapter: [05-Memory System](05-memory-system.md).
