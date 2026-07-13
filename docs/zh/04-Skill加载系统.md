# 04 - Skill 加载系统

本章你将学会：用声明式 SKILL.md 文件扩展 Agent 的知识，按需加载不浪费 token。

## 与 Plugin 的区别

| | Plugin | Skill |
|---|---|---|
| 本质 | TypeScript 代码（工具+钩子+规则） | 声明式 Markdown 文件 |
| 加载时机 | 代码安装时 | 模型按需调用 `load_skill` |
| 用途 | 扩展 Agent 的能力 | 注入项目规范、风格指南、领域知识 |
| 代价 | 不占上下文（工具定义始终在） | 目录 ~100 token/技能，内容 ~2000 |

## 目录结构

```
skills/
  react-style/
    SKILL.md
  sql-guide/
    SKILL.md
  api-design/
    SKILL.md
```

## SKILL.md 格式

```markdown
---
name: react-style
description: React component style conventions
---

# React 组件规范

- 使用函数组件 + Hooks
- 每个组件一个文件
- ...
```

## 装到 Agent

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

await agent.init(); // 扫描 skills/ 目录
```

启动后，模型在 system prompt 中看到技能目录（少 token），需要时调用 `load_skill('react-style')` 获取完整内容。子 Agent 默认不含技能。

下一章：[05-记忆系统](05-记忆系统.md)。
