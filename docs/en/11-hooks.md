# 10 - Hooks

In this chapter you will learn: how to inject your own logic at key points in the agent run loop (auditing, rewriting, intercepting).

## 1. What Are Hooks

Hooks are event extension points in the agent loop. You register a callback, and the framework invokes it at a
specific moment — **without modifying the agent's internal code**.

Four events:

| Event | Triggered when | What you can do |
|---|---|---|
| `UserPromptSubmit` | Before user input enters the loop | Rewrite input, early termination |
| `PreToolUse` | Before tool execution | Block the tool call, inject a result |
| `PostToolUse` | After tool execution | Audit, log |
| `Stop` | When the loop ends | Cleanup |

## 2. Registering Hooks

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

// PostToolUse: log after every tool execution
agent.registerHook('PostToolUse', (payload) => {
  const p = payload as { tool: { name: string }; result: string };
  console.log(`[审计] 工具 ${p.tool.name} 执行完，结果长度 ${p.result.length}`);
});
```

## 3. Rewriting User Input

`UserPromptSubmit` can replace the user input with something else:

```ts
agent.registerHook('UserPromptSubmit', (payload) => {
  const p = payload as { input: string };
  // e.g., automatically append a constraint
  return { replaceInput: p.input + '\n（请用中文回答）' };
});
```

Return `{ replaceInput: '...' }` to substitute; return nothing or `undefined` to leave it unchanged.

## 4. Blocking Tool Calls

`PreToolUse` can prevent a tool from executing and directly return a result to the model:

```ts
agent.registerHook('PreToolUse', (payload) => {
  const p = payload as { tool: { name: string; input: Record<string, unknown> } };
  if (p.tool.name === 'bash' && /rm\s+-rf/.test(String(p.tool.input.command))) {
    return { blockWith: '禁止执行 rm -rf。' }; // this text is handed to the model as the tool result
  }
  return; // don't block
});
```

Return `{ blockWith: '...' }` to block and inject a result.

## 5. Priority

Multiple hooks execute in ascending `priority` order (lower numbers run first), default 100:

```ts
agent.registerHook('PostToolUse', cb1, 50);  // runs first
agent.registerHook('PostToolUse', cb2, 200); // runs second
```

## 6. Using HookManager (Standalone)

You can use it without going through Agent:

```ts
import { HookManager } from 'mochikit';

const hm = new HookManager();
hm.on('PreToolUse', (payload) => {
  // ...
});
const result = await hm.trigger('PreToolUse', { tool: {...}, agentName: 'a' });
```

## 7. Hook Return Value — HookResult

```ts
interface HookResult {
  blockWith?: string;        // PreToolUse: block and inject this result
  replaceInput?: string;     // UserPromptSubmit: replace the input
  stopLoop?: boolean;        // terminate the entire loop
}
```

## autoMemory and UserPromptSubmit

When `autoMemory: true` is set, the Agent internally uses a `UserPromptSubmit` hook to auto-inject memories. You can
also write the same logic by hand:

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

Next chapter: [12-Permission](12-permission.md).
