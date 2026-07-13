# 09 - 任务系统 TaskStore

本章你将学会：用带依赖的任务图拆解复杂工作，并让 Agent 管理这些任务。

## 1. TaskStore 是什么

`TaskStore` 是一个**有依赖关系的任务列表**（DAG）。每个任务有状态（pending/in_progress/completed），
可以声明“依赖哪些其他任务”——只有依赖都完成了，这个任务才能开始。

适合：多步工作流、多 Agent 并行协作时分配工作。

## 2. 直接操作任务

```ts
import { InMemoryTaskStore } from 'mochikit';

const tasks = new InMemoryTaskStore();

// 创建任务
const a = await tasks.create({ subject: '搭数据库', description: '初始化 schema', blockedBy: [] });
const b = await tasks.create({ subject: '写 API', description: 'CRUD 接口', blockedBy: [a.id] });

// b 依赖 a，a 没完成时 b 不能开始
await tasks.canStart(b.id); // false

// 认领并完成 a
await tasks.claim(a.id, 'worker-1');
const { unblocked } = await tasks.complete(a.id);
console.log(unblocked.map(t => t.id)); // 包含 b —— b 现在可启动了

await tasks.canStart(b.id); // true
```

任务结构：

```ts
interface Task {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner: string | null;     // 认领者
  blockedBy: string[];      // 依赖的任务 id
  createdAt: number;
}
```

## 3. TaskStore 的方法

| 方法 | 作用 |
|---|---|
| `create({ subject, description, blockedBy })` | 创建任务 |
| `get(id)` | 读取单条 |
| `list()` | 列出全部 |
| `canStart(id)` | 是否可启动（pending 且依赖已 completed） |
| `claim(id, agent)` | 认领（设为 in_progress + owner） |
| `complete(id)` | 完成，返回 `{ task, unblocked }`（新解锁的任务） |
| `remove(id)` | 删除 |

## 4. 让 Agent 管理任务

把 `tasks` 接到 Agent 并装上任务工具：

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

await agent.run('为“上线登录功能”创建一个任务并完成它。');
console.log((await tasks.list()).map(t => `${t.subject}: ${t.status}`));
```

Agent 可用的工具：

- `create_task`：创建任务（可带 `blockedBy`）
- `claim_task`：认领任务
- `complete_task`：完成任务

## 5. 多 Agent 协作分配

配合 Team/ManagerWorker：Manager 用 `create_task` 拆出带依赖的子任务，Workers 用 `claim_task`
认领自己能做的（`canStart` 为 true 的），完成后 `complete_task` 自动解锁下游。这就是教程里的
“自治 Agent”模式的基础。

下一章：[11-钩子-Hooks](11-钩子-Hooks.md)。
