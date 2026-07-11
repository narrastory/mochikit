# 06 - 多智能体 Manager-Worker

本章你将学会：让一个“管理者”Agent 把子任务委派给多个“工人”Agent。

## 1. Manager-Worker 是什么

- **Manager（管理者）**：接收用户请求，拆解任务，决定委派给谁。
- **Worker（工人）**：专注某类子任务（查资料、算数学、写代码……），完成后把结果摘要交回 Manager。

关键点：Worker 在**独立、干净的上下文**里运行，只把摘要结果返回给 Manager——
这样 Manager 的上下文不会被海量细节撑爆。

## 2. 最小例子

```ts
import {
  Agent, AnthropicAdapter, loadConfig, ManagerWorker,
  createBashTool, AllowAllResolver, PermissionManager,
} from 'mochikit';

const cfg = loadConfig();
const llm = () => new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
const perm = () => new PermissionManager({ resolver: new AllowAllResolver() });

// 工人 1：查资料
const researcher = new Agent({
  name: 'researcher',
  llm: llm(), model: cfg.model,
  systemPrompt: '你是资料研究员，简洁回答关键发现。',
  permission: perm(), maxTurns: 4,
});

// 工人 2：算数（带 bash 工具）
const calculator = new Agent({
  name: 'calculator',
  llm: llm(), model: cfg.model,
  systemPrompt: '你是计算员，用 bash 工具计算，只返回数字结果。',
  tools: [createBashTool()],
  permission: perm(), maxTurns: 4,
});

// 管理者
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
console.log(out); // 预期含 86400
```

## 3. 工作流程

1. `mw.run(用户请求)` 实际调用 `manager.run(请求)`。
2. Manager 思考后调用 `spawn_teammate` 工具，参数形如 `{ worker: 'calculator', task: '计算一天秒数' }`。
3. 框架找到名为 `calculator` 的 Worker，**重置其上下文**后运行 `worker.run(task)`。
4. Worker 返回最终文本，作为工具结果交回 Manager。
5. Manager 汇总，输出最终答案。

> Manager 自动获得 `spawn_teammate` 工具，无需手动注册。

## 4. spawn_teammate 工具

它的参数：

```json
{
  "worker": "工人名字",
  "task": "自包含的子任务描述"
}
```

如果传了不存在的工人名，会返回错误信息（而不是崩溃），Manager 可以据此改派。

## 5. 为什么 Worker 要隔离上下文

子任务可能产生大量中间工具输出（读了很多文件、跑了很多命令）。如果直接共享 Manager 上下文，
很快就会爆。隔离后，Manager 只看到一句摘要，保持“视野清晰”。

## 6. 直接调用 Subagent（不用 Manager 模式）

如果你只想在代码里手动派一个一次性子任务：

```ts
import { spawnSubagent } from 'mochikit';

const summary = await spawnSubagent(researcher, '调研一下 WebAssembly 的现状');
console.log(summary);
```

`spawnSubagent(agent, task)` 会重置 agent 上下文并运行，返回摘要。

下一章：[07-顺序链-SequentialChain](07-顺序链-SequentialChain.md)。
