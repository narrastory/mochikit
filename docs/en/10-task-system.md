# 09 - Task System (TaskStore)

In this chapter you will learn: how to break down complex work using a dependency-aware task graph, and how to let agents manage those tasks.

## 1. What Is TaskStore

`TaskStore` is a **dependency-ordered task list** (DAG). Each task has a status (pending/in_progress/completed)
and can declare which other tasks it depends on — a task can only start once all its dependencies are completed.

Ideal for: multi-step workflows, distributing work in multi-agent parallel collaboration.

## 2. Direct Task Manipulation

```ts
import { InMemoryTaskStore } from 'mochikit';

const tasks = new InMemoryTaskStore();

// Create tasks
const a = await tasks.create({ subject: '搭数据库', description: '初始化 schema', blockedBy: [] });
const b = await tasks.create({ subject: '写 API', description: 'CRUD 接口', blockedBy: [a.id] });

// b depends on a; while a is incomplete, b cannot start
await tasks.canStart(b.id); // false

// Claim and complete a
await tasks.claim(a.id, 'worker-1');
const { unblocked } = await tasks.complete(a.id);
console.log(unblocked.map(t => t.id)); // includes b — b can now start

await tasks.canStart(b.id); // true
```

Task structure:

```ts
interface Task {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner: string | null;     // claimant
  blockedBy: string[];      // IDs of tasks this depends on
  createdAt: number;
}
```

## 3. TaskStore Methods

| Method | Purpose |
|---|---|
| `create({ subject, description, blockedBy })` | Create a task |
| `get(id)` | Read a single task |
| `list()` | List all tasks |
| `canStart(id)` | Whether it can start (pending and dependencies are completed) |
| `claim(id, agent)` | Claim (set to in_progress + owner) |
| `complete(id)` | Complete, returns `{ task, unblocked }` (newly unblocked tasks) |
| `remove(id)` | Delete |

## 4. Letting an Agent Manage Tasks

Wire a `tasks` store into an Agent and install task tools:

```ts
import {
  Agent, AnthropicAdapter, loadConfig, InMemoryTaskStore, createTaskTools,
  AllowAllResolver, PermissionManager,
} from 'mochikit';

const cfg = loadConfig();
const tasks = new InMemoryTaskStore();

const agent = new Agent({
  name: 'pm',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: '你用 create_task 拆任务、用 complete_task 完成任务。',
  tasks,
  tools: createTaskTools(tasks),
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

await agent.run('为"上线登录功能"创建一个任务并完成它。');
console.log((await tasks.list()).map(t => `${t.subject}: ${t.status}`));
```

Tools available to the agent:

- `create_task`: create a task (can include `blockedBy`)
- `claim_task`: claim a task
- `complete_task`: complete a task

## 5. Multi-Agent Collaborative Assignment

Use with Team/ManagerWorker: the Manager uses `create_task` to break down dependent subtasks, and Workers use
`claim_task` to claim tasks they can handle (those where `canStart` returns true); completing them with
`complete_task` automatically unblocks downstream tasks. This is the foundation of the "autonomous agent" pattern
in the tutorial.

Next chapter: [11-Hooks](11-hooks.md).
