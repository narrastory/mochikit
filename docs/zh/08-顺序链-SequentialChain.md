# 07 - 顺序链 SequentialChain

本章你将学会：把多个 Agent 串成流水线，前一个的输出喂给后一个。

## 1. 顺序链是什么

不同于 Manager-Worker（Manager 动态决定派给谁），**顺序链**是固定的流水线：
Agent A → Agent B → Agent C，每个的输出作为下一个的输入。

典型用途：起草 → 评审 → 润色；翻译 → 校对；分析 → 总结。

## 2. 基础例子

```ts
import {
  Agent, AnthropicAdapter, loadConfig, SequentialChain,
  AllowAllResolver, PermissionManager,
} from 'mochikit';

const cfg = loadConfig();
const llm = new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
const perm = () => new PermissionManager({ resolver: new AllowAllResolver() });

const drafter = new Agent({
  name: 'drafter', llm, model: cfg.model, permission: perm(), maxTurns: 3,
  systemPrompt: '为给定主题起草一段产品描述，只输出段落。',
});
const critic = new Agent({
  name: 'critic', llm, model: cfg.model, permission: perm(), maxTurns: 3,
  systemPrompt: '用一句话点评文本，指出最重要的一个改进点。',
});
const polisher = new Agent({
  name: 'polisher', llm, model: cfg.model, permission: perm(), maxTurns: 3,
  systemPrompt: '应用点评意见，产出最终润色段落，只输出段落。',
});

const chain = new SequentialChain({ agents: [drafter, critic, polisher] });

const final = await chain.run('主题：一个能保持咖啡最佳温度的智能马克杯。');
console.log(final);
```

执行流程：`drafter.run(主题)` → 输出 → `critic.run(草稿)` → 输出 → `polisher.run(点评)` → 最终输出。

## 3. 共享记忆

链上各阶段可以共享一个 `Memory`，让后续阶段召回前面沉淀的信息：

```ts
import { MarkdownMemory } from 'mochikit';

const memory = new MarkdownMemory({ dir: './.mochikit/chain' });

const chain = new SequentialChain({
  agents: [drafter, critic, polisher],
  sharedMemory: memory,
});
```

每个 Agent 还需各自装上记忆工具（`createMemoryTools(memory)`）才能读写。

## 4. 与 Manager-Worker 的区别

| 维度 | SequentialChain | ManagerWorker |
|---|---|---|
| 拓扑 | 固定线性流水 | Manager 动态派发 |
| 控制权 | 代码（你定顺序） | Manager 模型（它定派谁） |
| 适合 | 明确的多步加工 | 不确定、需拆解的任务 |

可以组合使用：一个链的某一环本身是个 ManagerWorker。

下一章：[09-Team与信箱通信](09-Team与信箱通信.md)。
