# MochiKit 使用教程

MochiKit 是一个基于 TypeScript + Node.js 的现代 AI Agent 开发框架。它的核心理念是
**“复杂度在 harness（外壳），不在 model（大脑）”**：一个可组合的 AgentLoop 承载推理循环，
其余能力（工具、记忆、权限、钩子、多智能体协同）全部以可插拔组件接入。

本教程覆盖：安装配置 → 单 Agent → 工具 → 记忆与向量 → 多智能体协同 → 插件 → 进阶。

---

## 1. 安装与配置

```bash
npm install        # 安装依赖（@anthropic-ai/sdk, dotenv, vitest, tsx, typescript）
cp .env.example .env
# 编辑 .env，填入 BASE_URL / API_KEY / MODEL
```

`.env` 示例（GLM 智谱的 Anthropic 兼容端点）：

```dotenv
BASE_URL=https://open.bigmodel.cn/api/anthropic
API_KEY=your-zhipu-key
MODEL=glm-4.7
```

最小可运行示例：

```ts
import { Agent, AnthropicAdapter, loadConfig, createBashTool, AllowAllResolver, PermissionManager } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'hello',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You are a helpful assistant. Be concise.',
  tools: [createBashTool()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

const answer = await agent.run('用 bash 列出当前目录的文件');
console.log(answer);
```

运行：`npx tsx your-file.ts`（或参考 `examples/01-simple-agent.ts`）。

---

## 2. 核心概念

| 概念 | 说明 |
|---|---|
| `LLMClient` | LLM 抽象层；`AnthropicAdapter` 是其实现，兼容 GLM/Claude 等 Anthropic 协议端点 |
| `Tool` / `ToolRegistry` | 工具契约与注册/派发；支持 MCP 风格命名空间隔离 |
| `HookManager` | 生命周期钩子：`UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `Stop` |
| `PermissionManager` | 三段闸门：deny → rule → ask |
| `ConversationContext` | 对话历史 + token 估算 |
| `CompactionPipeline` | 分层上下文压缩（budget / micro / snip / reactive） |
| `Recovery` | 重试与错误恢复（429/529 退避、prompt_too_long 反应式压缩、max_tokens 升级） |
| `AgentLoop` | 核心循环：`LLM → tool_use → results → repeat` |
| `Agent` | 用户面基类，通过依赖注入组合上述组件，并实现 `PluginHost` |

**数据流**：

```
run(input)
 → UserPromptSubmit hooks
 → while (turns < maxTurns):
     压缩 → 组装 system → withRetry(LLM) → 分流 stop_reason
       end_turn   → 返回最终文本
       max_tokens → 升级重试
       tool_use   → PreToolUse → Permission → execute → PostToolUse → 回填 tool_result
```

---

## 3. 工具（Tools）

### 3.1 使用内置工具

```ts
import { createBashTool, createFsTools, createWebSearchTool, createWebReaderTool, createMemoryTools, createTaskTools } from 'mochikit';

const tools = [
  createBashTool(),
  ...createFsTools(),                       // read_file / write_file / edit_file / glob / grep
  createWebSearchTool(cfg.webApiKey),       // GLM /paas/v4/web_search
  createWebReaderTool(cfg.webApiKey),       // GLM /paas/v4/reader
  ...createMemoryTools(memory),
  ...createTaskTools(taskStore),
];
```

### 3.2 自定义工具

继承 `BaseTool`，声明 `definition`（JSON Schema）并实现 `execute`：

```ts
import { BaseTool, type ToolContext } from 'mochikit';

class WeatherTool extends BaseTool {
  readonly definition = {
    name: 'get_weather',
    description: 'Get the weather for a city.',
    input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  };
  async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const city = this.requireString(input, 'city');
    return `The weather in ${city} is sunny.`;
  }
}

const agent = new Agent({ /* ... */ tools: [new WeatherTool()] });
```

也可用 `toolFromFunction(definition, fn)` 快速包装一个函数为工具。

---

## 4. 记忆与向量（Memory & VectorStore）

### 4.1 统一 Memory 接口

```ts
export interface Memory {
  add(entry: NewMemoryEntry): Promise<MemoryEntry>;
  get(id: string): Promise<MemoryEntry | null>;
  list(): Promise<MemoryEntry[]>;
  query(needle: string, k?: number): Promise<MemoryEntry[]>;
  update(id: string, patch: Partial<NewMemoryEntry>): Promise<MemoryEntry>;
  remove(id: string): Promise<void>;
}
```

### 4.2 Markdown 文件记忆

每条记忆存为 `.mochikit/memory/<slug>.md`（YAML frontmatter + 正文），并维护 `MEMORY.md` 索引。
默认 `query` 用关键词召回；可注入 LLM 召回器：

```ts
import { MarkdownMemory } from 'mochikit';

const memory = new MarkdownMemory({
  dir: './.mochikit/memory',
  recall: async (entries, needle, k) => { /* 用 LLM 选 top-k */ return entries.slice(0, k); },
});

await memory.add({ name: '用户偏好简洁', type: 'feedback', description: '少废话', body: '回答尽量短。' });
const hits = await memory.query('回答风格');
```

让 Agent 自主读写记忆：`tools: createMemoryTools(memory)`（提供 `memory_read` / `memory_write`）。

### 4.3 向量存储

```ts
import { InMemoryVectorStore } from 'mochikit';

const store = new InMemoryVectorStore();
await store.add([{ id: 'd1', vector: [0.1, 0.9], metadata: { tag: 'a' } }]);
const nearest = await store.query([0.15, 0.85], 5, { tag: 'a' });
```

`VectorStore` 是扩展契约。接入 Chroma / Pinecone 时，实现该接口即可（`add` / `query` / `remove`
签名一致，第三方 SDK 作为 optional peerDependency）。详见 `Design/Architecture_Design.md`。

---

## 5. 多智能体协同

### 5.1 Manager-Worker

Manager 持有 `spawn_teammate` 工具，把子任务派发给命名的 Worker；Worker 在**隔离上下文**中执行，
仅返回摘要，保持 Manager 上下文整洁。

```ts
import { Agent, ManagerWorker } from 'mochikit';

const researcher = new Agent({ name: 'researcher', /* ... */ });
const calculator = new Agent({ name: 'calculator', /* ... */ });

const mw = new ManagerWorker({
  manager: new Agent({ name: 'manager', /* ... */ }),
  workers: [{ name: 'researcher', agent: researcher }, { name: 'calculator', agent: calculator }],
});

const out = await mw.run('调研 X 并计算 Y');
```

### 5.2 顺序链（Sequential Chain）

```ts
import { SequentialChain } from 'mochikit';

const chain = new SequentialChain({
  agents: [drafter, critic, polisher],
  sharedMemory: memory,   // 可选：链上共享记忆
});
const final = await chain.run('主题：智能恒温马克杯');
```

### 5.3 Team + 信箱（MessageBus）

成员通过文件/内存信箱异步通信（`send_message` / `check_inbox`）：

```ts
import { Team, InMemoryMessageBus } from 'mochikit';

const team = new Team({ members: [alice, bob], bus: new InMemoryMessageBus() });
await team.run('alice', '请把结果发给 bob');
```

### 5.4 任务图（TaskStore）

带 `blockedBy` 依赖的 DAG，支持认领与完成回报：

```ts
import { InMemoryTaskStore } from 'mochikit';
const tasks = new InMemoryTaskStore();
const a = await tasks.create({ subject: 'A', description: '', blockedBy: [] });
const b = await tasks.create({ subject: 'B', description: '', blockedBy: [a.id] });
await tasks.canStart(b.id); // false
await tasks.claim(a.id, 'worker1');
const { unblocked } = await tasks.complete(a.id); // B 现在可启动
```

---

## 6. 插件（Plugins）

插件把“工具 + 钩子 + 权限规则”打包复用：

```ts
import { PluginBuilder } from 'mochikit';

const auditPlugin = new PluginBuilder('audit')
  .hook('PostToolUse', (p) => { /* 记录日志 */ })
  .rule({ name: 'no-rm', tools: ['bash'], check: (ctx) => /rm -rf/.test(String(ctx.tool.input.command)) ? 'deny' : 'passthrough', reason: 'destructive' })
  .build();

agent.use(auditPlugin);
```

也可直接实现 `Plugin` 接口，或用 `PluginRegistry` 在多个 Agent 间共享同一组注册。

---

## 7. 权限与安全

`PermissionManager` 三段闸门：

1. **deny**：黑名单/显式拒绝规则 → 直接阻止。
2. **rule**：规则命中产生 reason → 交由 `PermissionResolver` 决定。
3. **ask**：`AllowAllResolver`（放行，适合沙箱/测试）/ `DenyAllResolver`（全拒，审计）/ 自定义交互式询问。

```ts
import { PermissionManager } from 'mochikit';

const permission = new PermissionManager({
  resolver: new AllowAllResolver(),
  rules: [{
    name: 'workspace-write',
    tools: ['write_file', 'edit_file'],
    check: (ctx) => (!String(ctx.tool.input.path).startsWith(process.cwd()) ? 'deny' : 'passthrough'),
    reason: '禁止写入工作区外',
  }],
});
```

---

## 8. 测试

- **单元测试**：`npm run test:unit`（mock LLMClient，不触网）。
- **集成测试**：`npm run test:integration`（真实调用 GLM，需 `.env` 与 `MOCHIKIT_RUN_INTEGRATION=1`）。

自定义测试注入 mock 客户端：

```ts
import { Agent } from 'mochikit';

const mockLlm = {
  async create() {
    return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };
  },
};
const agent = new Agent({ name: 't', llm: mockLlm, model: 'm', systemPrompt: 's' });
```

---

## 9. 目录速查

| 路径 | 内容 |
|---|---|
| `src/core/` | 引擎核心（types, llm-client, tool, hooks, permission, compaction, recovery, agent-loop, agent） |
| `src/collaboration/` | Manager-Worker / Chain / Team / Subagent |
| `src/memory/` | Memory 接口、MarkdownMemory、VectorStore 接口、InMemoryVectorStore |
| `src/tools/` | 内置工具（fs, bash, web-reader, web-search, memory, task, team） |
| `src/plugins/` | Plugin / PluginHost / PluginRegistry |
| `src/infra/` | MessageBus / TaskStore / Config |
| `Design/Architecture_Design.md` | 架构设计文档 |
| `examples/` | 5 个可运行示例 |

---

## 10. 设计要点回顾

- **DI**：所有依赖构造函数注入，便于替换与测试。
- **严格类型**：禁用 `any`，`strict` 模式。
- **OOP**：`BaseTool` / `Agent` / `MarkdownMemory` 等以类组织，接口抽象行为。
- **可扩展**：实现 `LLMClient` / `Memory` / `VectorStore` / `Tool` / `Plugin` 任一接口即可接入新后端。
