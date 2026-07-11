# 02 - 第一个 Agent

本章你将学会：创建一个 Agent、给它设定角色、运行它并拿到回答。

## 1. Agent 是什么

在 MochiKit 里，一个 `Agent` 就是“一个会思考、能用工具的 AI 助手实例”。你给它：

- 一个 LLM 客户端（决定用哪个模型）
- 一段系统提示词（system prompt，决定它扮演谁）
- 一组工具（可选，决定它能做什么动作）

然后调用 `agent.run("你的问题")`，它就会思考并返回答案。

## 2. 最小例子

```ts
import { Agent, AnthropicAdapter, loadConfig } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'my-agent',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: '你是一个友好的技术助手，回答简洁。',
});

const reply = await agent.run('什么是依赖注入？');
console.log(reply);
```

预期输出：一段对依赖注入的简洁解释。

## 3. Agent 的全部选项

```ts
const agent = new Agent({
  name: 'my-agent',            // 必填：名字（也用于日志/权限/多智能体）
  llm: ...,                    // 必填：LLM 客户端
  model: 'glm-4.7',            // 必填：模型名
  systemPrompt: '...',         // 必填：系统提示词

  tools: [],                   // 可选：工具数组
  memory: ...,                 // 可选：记忆实例
  bus: ...,                    // 可选：消息总线（多智能体用）
  tasks: ...,                  // 可选：任务存储
  hooks: ...,                  // 可选：钩子管理器
  permission: ...,             // 可选：权限管理器

  maxTurns: 30,                // 可选：最大思考轮数（防失控），默认 30
  maxTokens: 8192,             // 可选：单次回复最大 token，默认 8192
  fallbackModel: undefined,    // 可选：过载时的备用模型
  cwd: process.cwd(),          // 可选：工具执行的工作目录
});
```

## 4. 多轮对话

`agent.run()` 会把对话历史保留在 Agent 内部。连续调用即可多轮：

```ts
await agent.run('我叫小明。');
const reply = await agent.run('我叫什么名字？');
console.log(reply); // 应能答出“小明”
```

如果想清空历史重新开始：

```ts
agent.reset();
```

## 5. maxTurns 是什么

Agent 内部是一个循环：模型思考 → 调工具 → 把结果喂回模型 → 再思考……直到模型不再要求调工具。
`maxTurns` 是这个循环的安全上限，防止模型陷入死循环。普通问答 1 轮就结束；用工具时通常 3–8 轮。

## 6. 给 Agent 加工具

下一章详细讲，这里先看一眼：

```ts
import { createBashTool, createFsTools, AllowAllResolver, PermissionManager } from 'mochikit';

const agent = new Agent({
  name: 'coder',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: '你是编码助手，可用 bash 与文件工具。',
  tools: [createBashTool(), ...createFsTools()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

console.log(await agent.run('列出当前目录的文件'));
```

> 工具涉及执行代码/写文件，建议搭配 `PermissionManager`（见第 11 章）控制权限。

## 7. 常见问题

- **报错 `Invalid URL`**：检查 `.env` 的 `BASE_URL` 是否正确加载（见 15 章）。
- **Agent 一直不结束**：调小 `maxTurns`，或检查工具是否返回了有效结果。
- **回答太长被截断**：调大 `maxTokens`。

下一章：[03-工具系统](03-工具系统.md)。
