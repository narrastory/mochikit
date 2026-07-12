# 10 - 钩子 Hooks

本章你将学会：在 Agent 运行的关键节点插入自己的逻辑（审计、改写、拦截）。

## 1. 钩子是什么

钩子是 Agent 循环里的事件扩展点。你注册一个回调，框架在特定时机调用它，**不用改 Agent 内部代码**。

四个事件：

| 事件 | 触发时机 | 能做什么 |
|---|---|---|
| `UserPromptSubmit` | 用户输入进入循环前 | 改写输入、提前终止 |
| `PreToolUse` | 工具执行前 | 阻断工具调用、注入结果 |
| `PostToolUse` | 工具执行后 | 审计、记录 |
| `Stop` | 循环结束 | 收尾 |

## 2. 注册钩子

```ts
import { Agent, AnthropicAdapter, loadConfig, createBashTool, AllowAllResolver, PermissionManager } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'audited',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: '你是助手。',
  tools: [createBashTool()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

// PostToolUse：每次工具执行后记录
agent.registerHook('PostToolUse', (payload) => {
  const p = payload as { tool: { name: string }; result: string };
  console.log(`[审计] 工具 ${p.tool.name} 执行完，结果长度 ${p.result.length}`);
});
```

## 3. 改写用户输入

`UserPromptSubmit` 可以把用户输入替换成别的：

```ts
agent.registerHook('UserPromptSubmit', (payload) => {
  const p = payload as { input: string };
  // 比如自动给输入加一句约束
  return { replaceInput: p.input + '\n（请用中文回答）' };
});
```

返回 `{ replaceInput: '...' }` 即替换；不返回或返回 `undefined` 表示不改。

## 4. 阻断工具调用

`PreToolUse` 可以阻止某个工具执行，并直接返回一个结果给模型：

```ts
agent.registerHook('PreToolUse', (payload) => {
  const p = payload as { tool: { name: string; input: Record<string, unknown> } };
  if (p.tool.name === 'bash' && /rm\s+-rf/.test(String(p.tool.input.command))) {
    return { blockWith: '禁止执行 rm -rf。' }; // 这段文本会作为工具结果给模型
  }
  return; // 不阻断
});
```

返回 `{ blockWith: '...' }` 即阻断并注入结果。

## 5. 优先级

多个钩子按 `priority` 升序执行（数字小先跑），默认 100：

```ts
agent.registerHook('PostToolUse', cb1, 50);  // 先跑
agent.registerHook('PostToolUse', cb2, 200); // 后跑
```

## 6. 用 HookManager（独立使用）

不通过 Agent 也能用：

```ts
import { HookManager } from 'mochikit';

const hm = new HookManager();
hm.on('PreToolUse', (payload) => {
  // ...
});
const result = await hm.trigger('PreToolUse', { tool: {...}, agentName: 'a' });
```

## 7. 钩子返回值 HookResult

```ts
interface HookResult {
  blockWith?: string;        // PreToolUse：阻断并注入此结果
  replaceInput?: string;     // UserPromptSubmit：替换输入
  stopLoop?: boolean;        // 终止整个循环
}
```

## autoMemory 与 UserPromptSubmit

设置 `autoMemory: true` 时，Agent 内部通过 `UserPromptSubmit` 钩子实现记忆自动注入。你也可以手写同样的逻辑：

```ts
agent.registerHook('UserPromptSubmit', async (p) => {
  const payload = p as { input: string; agentName: string };
  const relevant = await memory.query(payload.input, 3);
  if (relevant.length > 0) {
    const memBlock = relevant.map(e => `[Memory: ${e.name}] ${e.body}`).join('\n');
    return { replaceInput: `<relevant_memories>\n${memBlock}\n</relevant_memories>\n\n${payload.input}` };
  }
});
```

下一章：[11-权限系统](11-权限系统.md)。
