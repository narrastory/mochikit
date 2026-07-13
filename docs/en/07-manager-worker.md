# 06 - Multi-Agent Manager-Worker

In this chapter you will learn: how to have a "manager" agent delegate subtasks to multiple "worker" agents.

## 1. What Is Manager-Worker

- **Manager**: receives the user request, decomposes the task, and decides who to delegate to.
- **Worker**: focuses on a specific kind of subtask (research, calculation, coding…), then returns a summary result to the Manager.

Key insight: each Worker runs in an **isolated, clean context** and only returns a summary result to the Manager —
so the Manager's context won't be blown up by massive details.

## 2. Minimal Example

```ts
import {
  Agent, AnthropicAdapter, loadConfig, ManagerWorker,
  createBashTool, AllowAllResolver, PermissionManager,
} from 'mochikit';

const cfg = loadConfig();
const llm = () => new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
const perm = () => new PermissionManager({ resolver: new AllowAllResolver() });

// Worker 1: research
const researcher = new Agent({
  name: 'researcher',
  llm: llm(), model: cfg.model,
  systemPrompt: '你是资料研究员，简洁回答关键发现。',
  permission: perm(), maxTurns: 4,
});

// Worker 2: calculation (with bash tool)
const calculator = new Agent({
  name: 'calculator',
  llm: llm(), model: cfg.model,
  systemPrompt: '你是计算员，用 bash 工具计算，只返回数字结果。',
  tools: [createBashTool()],
  permission: perm(), maxTurns: 4,
});

// Manager
const manager = new Agent({
  name: 'manager',
  llm: llm(), model: cfg.model,
  systemPrompt:
    '你是管理者。把子任务委派给 researcher（查资料）或 calculator（算数），用 spawn_teammate 工具，然后汇总。',
  permission: perm(), maxTurns: 6,
});

const mw = new ManagerWorker({
  manager,
  workers: [
    { name: 'researcher', agent: researcher },
    { name: 'calculator', agent: calculator },
  ],
});

const out = await mw.run('一天有多少秒？交给 calculator 算。');
console.log(out); // expected to contain 86400
```

## 3. Workflow

1. `mw.run(userRequest)` actually calls `manager.run(request)`.
2. The Manager thinks, then calls the `spawn_teammate` tool with parameters like `{ worker: 'calculator', task: '计算一天秒数' }`.
3. The framework locates the Worker named `calculator`, **resets its context**, then runs `worker.run(task)`.
4. The Worker returns its final text, which is handed back to the Manager as a tool result.
5. The Manager synthesizes and outputs the final answer.

> The Manager automatically receives the `spawn_teammate` tool — no manual registration required.

## 4. The spawn_teammate Tool

Its parameters:

```json
{
  "worker": "worker name",
  "task": "self-contained subtask description"
}
```

If you pass a non-existent worker name, an error message is returned (no crash), so the Manager can reassign accordingly.

## 5. Why Worker Contexts Are Isolated

Subtasks can generate massive intermediate tool output (lots of files read, many commands run). If shared directly
with the Manager's context, the context would overflow quickly. With isolation, the Manager only sees a one-line
summary, keeping its "view clear."

## 6. Direct Subagent Invocation (Without Manager Mode)

If you just want to manually dispatch a one-off subtask from code:

```ts
import { spawnSubagent } from 'mochikit';

const summary = await spawnSubagent(researcher, '调研一下 WebAssembly 的现状');
console.log(summary);
```

`spawnSubagent(agent, task)` resets the agent's context, runs it, and returns the summary.

Next chapter: [08-Sequential Chain](08-sequential-chain.md).
