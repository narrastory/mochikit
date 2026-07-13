# 07 - Sequential Chain

In this chapter you will learn: how to chain multiple agents into a pipeline, where the previous agent's output feeds into the next.

## 1. What Is a Sequential Chain

Unlike Manager-Worker (where the Manager dynamically decides whom to delegate to), a **sequential chain** is a fixed pipeline:
Agent A → Agent B → Agent C, each one's output becomes the next one's input.

Typical use cases: draft → review → polish; translate → proofread; analyze → summarize.

## 2. Basic Example

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

Execution flow: `drafter.run(topic)` → output → `critic.run(draft)` → output → `polisher.run(feedback)` → final output.

## 3. Shared Memory

Stages in the chain can share a `Memory` instance, letting later stages recall information deposited earlier:

```ts
import { MarkdownMemory } from 'mochikit';

const memory = new MarkdownMemory({ dir: './.mochikit/chain' });

const chain = new SequentialChain({
  agents: [drafter, critic, polisher],
  sharedMemory: memory,
});
```

Each agent also needs its own memory tools installed (`createMemoryTools(memory)`) to read and write.

## 4. Differences from Manager-Worker

| Dimension | SequentialChain | ManagerWorker |
|---|---|---|
| Topology | Fixed linear pipeline | Manager dispatches dynamically |
| Control | Code (you define the order) | Manager model (it decides who to delegate to) |
| Best for | Well-defined multi-step processing | Uncertain, decomposable tasks |

You can combine them: one link in a chain can itself be a ManagerWorker.

Next chapter: [09-Team Messaging](09-team-messaging.md).
