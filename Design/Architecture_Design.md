# MochiKit 架构设计文档

> MochiKit 是一个基于 TypeScript + Node.js 的现代化 AI Agent 开发框架。
> 设计灵感提炼自 ClaudeCode 设计机理教程（`AI-Agent-框架-教程/` 20 章），将其系统化为可复用、可组合、可测试的框架原语。

---

## 1. 设计目标

| 目标 | 说明 |
|---|---|
| 多智能体协同 | 原生支持 Manager-Worker、顺序链式 (Sequential Chain)、Team 信箱通信 |
| 极度灵活的插件化 | 核心引擎轻量；领域能力通过 `Tool` / `Plugin` / `Hook` 接入 |
| 统一记忆抽象 | 统一 `Memory` 接口；内置 Markdown 文件存储；`VectorStore` 接口 + 内存实现，预留 Chroma/Pinecone 契约 |
| 工程质量 | 严格 TS 类型（禁用 `any`）、OOP + 依赖注入 (DI)、TDD 可测试 |

### 核心设计哲学（来自教程 s20 的关键洞察）

> **复杂度在 harness（外壳），不在 model（大脑）。**
> 从 s01 到 s20，核心循环从未变得更复杂——始终是 `LLM → tool_use → results → repeat`。
> 所有机制（hooks / permissions / todos / skills / 压缩 / 恢复 / 后台 / cron / teams / worktree / MCP）
> 都挂载在这同一个循环上。框架的职责是组织环境，而非堆叠多个“大脑”。

因此 MochiKit 的核心是一个**可组合的 AgentLoop**，其余皆为可插拔组件。

---

## 2. 架构总览图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              MochiKit Framework                         │
│                                                                         │
│   ┌──────────────────────────────────────────────────────────────┐      │
│   │                    Collaboration Layer                       │      │
│   │  ManagerWorker · SequentialChain · Team · Subagent           │      │
│   └───────────────▲──────────────────────────▲───────────────────┘      │
│                   │ spawns / delegates       │ message                  │
│   ┌───────────────┴──────────────────────────┴───────────────────┐      │
│   │                        Core Engine                            │      │
│   │  ┌────────────┐  ┌──────────────┐  ┌────────────────────┐    │      │
│   │  │ AgentLoop  │──│  Agent (DI)  │──│  ConversationContext│    │      │
│   │  └─────┬──────┘  └──────┬───────┘  └────────────────────┘    │      │
│   │        │                │                                      │
│   │   ┌────▼────┐   ┌───────▼────────┐   ┌──────────────┐         │      │
│   │   │Recovery │   │ ToolRegistry   │   │  HookManager │         │      │
│   │   │(retry)  │   │ (dispatch map) │   │(Pre/PostTool)│         │      │
│   │   └─────────┘   └───────┬────────┘   └──────┬───────┘         │      │
│   │                         │                   │                 │      │
│   │   ┌─────────────┐  ┌────▼─────┐  ┌──────────▼──────┐          │      │
│   │   │ Compaction  │  │Permission│  │   LLMClient     │          │      │
│   │   │ (layered)   │  │ (3-gate) │  │ (AnthropicAdapt)│          │      │
│   │   └─────────────┘  └──────────┘  └─────────────────┘          │      │
│   └───────────────────────────────────────────────────────────────┘      │
│                   │ depends on (DI)          │ depends on (DI)            │
│   ┌───────────────┴───────────────┐  ┌───────┴────────────────────┐       │
│   │       Memory Layer            │  │      Infra Layer           │       │
│   │ Memory iface · MarkdownMemory │  │ MessageBus · TaskStore     │       │
│   │ VectorStore iface · InMemory  │  │ Config (dotenv)            │       │
│   └───────────────────────────────┘  └────────────────────────────┘       │
│                   │                                                      │
│   ┌───────────────┴──────────────────────────────────────────────┐       │
│   │                    Tools & Plugins                            │       │
│   │ fs · bash · web_reader · web_search · memory_* · task_*      │       │
│   │ team_* · PluginHost · Plugin iface                           │       │
│   └──────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 模块划分

| 层 | 模块 | 职责 | 关键类型 |
|---|---|---|---|
| Core | `core/types.ts` | 全局类型 | `Message`, `ContentBlock`, `ToolDefinition`, `LLMResponse` |
| Core | `core/llm-client.ts` | LLM 抽象 + Anthropic 适配 | `LLMClient`, `AnthropicAdapter` |
| Core | `core/tool.ts` | 工具契约 | `Tool`, `BaseTool`, `ToolContext` |
| Core | `core/tool-registry.ts` | 工具注册与派发 | `ToolRegistry` |
| Core | `core/hooks.ts` | 生命周期钩子 | `HookManager`, `HookEvent`, `HookCallback` |
| Core | `core/permission.ts` | 三段权限闸门 | `PermissionManager`, `PermissionResult` |
| Core | `core/context.ts` | 对话上下文 | `ConversationContext` |
| Core | `core/compaction.ts` | 分层上下文压缩 | `CompactionLayer`, `compact()` |
| Core | `core/recovery.ts` | 重试与错误恢复 | `withRetry()`, `RecoveryState` |
| Core | `core/agent-loop.ts` | 核心推理循环 | `AgentLoop` |
| Core | `core/agent.ts` | Agent 基类（DI 组合） | `Agent`, `AgentOptions` |
| Collab | `collaboration/*` | 多智能体协同 | `ManagerWorker`, `SequentialChain`, `Team`, `spawnSubagent` |
| Memory | `memory/*` | 记忆抽象层 | `Memory`, `MarkdownMemory`, `VectorStore`, `InMemoryVectorStore` |
| Tools | `tools/*` | 内置工具集 | 各 `Tool` 实现与工厂 |
| Plugins | `plugins/*` | 插件机制 | `Plugin`, `PluginHost` |
| Infra | `infra/*` | 基础设施 | `MessageBus`, `TaskStore`, `MochiConfig` |

---

## 4. 核心接口定义

### 4.1 消息与内容块

```ts
export type Role = 'system' | 'user' | 'assistant';

export interface TextBlock { type: 'text'; text: string }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message { role: Role; content: string | ContentBlock[] }

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema
}

export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: 'tool_use' | 'end_turn' | 'max_tokens' | string;
}
```

### 4.2 LLM 客户端抽象

```ts
export interface LLMClient {
  create(params: {
    model: string;
    system: string;
    messages: Message[];
    tools: ToolDefinition[];
    max_tokens: number;
  }): Promise<LLMResponse>;
}
```

`AnthropicAdapter` 包装 `@anthropic-ai/sdk` 的 `Anthropic` 客户端，构造时注入 `apiKey` 与 `baseURL`，兼容 GLM 的 Anthropic 兼容端点（`https://open.bigmodel.cn/api/anthropic`）。这是唯一与外部 LLM 服务的耦合点，便于在测试中替换为 mock。

### 4.3 工具契约

```ts
export interface ToolContext {
  agentName: string;
  cwd: string;
  memory?: Memory;
  bus?: MessageBus;
  tasks?: TaskStore;
}

export interface Tool {
  readonly definition: ToolDefinition;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
  /** 标记本工具是否可并发安全执行（用于批量调度） */
  isConcurrencySafe?(): boolean;
}
```

`BaseTool` 抽象类提供 `definition` 的构造与输入校验骨架，减少子类样板。

### 4.4 Agent 基类（DI 组合）

```ts
export interface AgentOptions {
  name: string;
  llm: LLMClient;
  model: string;
  systemPrompt: string;
  tools?: Tool[];
  memory?: Memory;
  hooks?: HookManager;
  permission?: PermissionManager;
  maxTurns?: number; // 安全上限，默认 30
}

export class Agent {
  constructor(private opts: AgentOptions);
  async run(input: string): Promise<string>; // 驱动 AgentLoop，返回最终文本
}
```

所有依赖通过构造函数注入：`llm`、`tools`、`memory`、`hooks`、`permission` 均可替换，确保可测试性。

### 4.5 记忆抽象

```ts
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface MemoryEntry {
  id: string;
  name: string;
  type: MemoryType;
  description: string;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface Memory {
  add(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
  get(id: string): Promise<MemoryEntry | null>;
  list(): Promise<MemoryEntry[]>;
  query(needle: string, k?: number): Promise<MemoryEntry[]>; // 默认关键词召回
  update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry>;
  remove(id: string): Promise<void>;
}
```

`MarkdownMemory` 将每条记忆存为 `.mochikit/memory/{slug}.md`（YAML frontmatter + body），并维护 `MEMORY.md` 索引（≤200 行），对齐教程 s09。

### 4.6 向量存储抽象（预留 Chroma/Pinecone）

```ts
export interface VectorItem { id: string; vector: number[]; metadata: Record<string, unknown> }

export interface VectorStore {
  add(items: VectorItem[]): Promise<void>;
  query(vector: number[], k: number, filter?: Record<string, unknown>): Promise<VectorItem[]>;
  remove(id: string): Promise<void>;
}
```

内置 `InMemoryVectorStore`（余弦相似度）用于测试与轻量场景。

**扩展契约（预留，不在本次实现真实依赖）**：
- `ChromaVectorStore implements VectorStore`：通过 Chroma 的 HTTP/JS client 调用 `collection.add` / `collection.query`。
- `PineconeVectorStore implements VectorStore`：通过 `@pinecone-database/pinecone` 的 `index.upsert` / `index.query`。
- 两者的 `add`/`query`/`remove` 签名与 `VectorStore` 一致；构造时注入各自的 client 连接配置。第三方依赖作为 optional peerDependency，未安装时构造抛出明确错误。

### 4.7 插件机制

```ts
export interface PluginHost {
  registerTool(tool: Tool): void;
  registerHook(event: HookEvent, cb: HookCallback): void;
  registerPermissionRule(rule: PermissionRule): void;
}

export interface Plugin {
  name: string;
  install(host: PluginHost): void;
}
```

`PluginHost` 由 `Agent` 实现，插件在 `install` 时把工具/钩子/权限规则注入框架。MCP 风格的命名空间隔离（`mcp__server__tool`）由 `ToolRegistry.registerNamespaced` 提供。

---

## 5. 多智能体通信机制

### 5.1 Manager-Worker

Manager agent 持有 `spawn_teammate` 工具。当模型调用该工具时，框架为子任务创建一个独立的 `Agent`（Worker）实例，**使用全新的消息上下文**（对齐 s06），Worker 执行完毕后**仅返回文本摘要**，避免污染 Manager 的上下文。Worker 的工具集中不含 `spawn_teammate`，防止递归。

### 5.2 顺序链式 (Sequential Chain)

`SequentialChain` 持有一组 `Agent`，按序执行：前一 agent 的输出文本作为后一 agent 的输入。可选共享一个 `Memory` 实例，使链上后续 agent 能召回前置阶段沉淀的记忆。

### 5.3 Team + 信箱 (MessageBus)

- `MessageBus` 为每个 agent 维护一个文件信箱 `.mochikit/mailbox/{agent}.jsonl`。
- `send_message(from, to, content, type)` 追加一行 JSON；`check_inbox(agent)` 读取并**消费**（读后删除）。
- 消息类型：`message` / `result` / `shutdown_request` / `shutdown_response` / `plan_approval_*`。
- `ProtocolState` 通过 `request_id` 关联请求-响应对，支撑有序协议（如关闭确认、计划审批）。
- 文件写入使用原子追加 + 进程级互斥，保证并发安全。

### 5.4 任务图 (TaskStore)

`TaskStore` 持久化任务 DAG（`.mochikit/tasks/{id}.json`）：
```ts
interface Task {
  id: string; subject: string; description: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner: string | null;
  blockedBy: string[]; // 依赖的任务 id
}
```
`canStart(id)` 校验所有 `blockedBy` 已 `completed`；`claim(id, agent)` 设置 owner；`complete(id)` 完成后回报新解锁的任务。Manager 可据此把大任务拆成依赖子任务分发给 Worker。

---

## 6. AgentLoop 数据流

```
run(input)
  │
  ▼
[UserPromptSubmit hooks]  ── 可修改/注入 prompt
  │
  ▼
┌─────────────── while (turns < maxTurns) ───────────────┐
│  1. 分层压缩 (compaction)                                │
│     - tool_result_budget  (持久化大输出，0 API)          │
│     - micro_compact       (保留最近 N 条 tool 结果)      │
│     - snip_compact        (裁剪中段)                     │
│     - 超阈值则 LLM summary (1 API)                       │
│  2. 组装 system prompt（runtime, 可缓存）                │
│  3. withRetry(LLM.create)                                │
│       - 429/529 指数退避 + jitter                        │
│       - 连续 529 → fallback model                        │
│       - prompt_too_long → reactive_compact 一次          │
│       - max_tokens → 升级 max_tokens 重试                │
│  4. stop_reason 分流：                                   │
│       end_turn   → 返回最终文本                          │
│       max_tokens → 升级后 continue                       │
│       tool_use   → 进入工具派发                          │
│  5. 遍历 tool_use blocks：                               │
│       [PreToolUse hooks]  ── 可阻断                      │
│       [Permission 闸门: deny → rule → ask]               │
│       execute tool (并发安全者可批量)                    │
│       [PostToolUse hooks]                                │
│       收集 tool_result                                   │
│  6. 回填 user message (tool_results)                     │
└─────────────────────────── ▲ ──────────────────────────┘
                            │
                       (loop until end_turn)
```

### Hooks 事件

| 事件 | 触发时机 | 可阻断 |
|---|---|---|
| `UserPromptSubmit` | 用户输入进入循环前 | 可修改输入 |
| `PreToolUse` | 工具执行前 | 可阻断执行 |
| `PostToolUse` | 工具执行后 | 否 |
| `Stop` | 循环结束 | 否 |

### Permission 三闸门

1. **deny**：硬黑名单（如 `rm -rf /`）→ 直接拒绝。
2. **rule**：规则匹配（如写工作区外路径）→ 触发询问。
3. **ask**：交由 `PermissionResolver`（默认实现可交互询问 / 测试中自动 allow/deny）。

`PermissionResult = 'allow' | 'deny' | 'ask' | 'passthrough'`。

---

## 7. 扩展点

| 扩展点 | 接口 | 典型用法 |
|---|---|---|
| 工具 | `Tool` | 注入领域工具（数据库查询、业务 API） |
| 插件 | `Plugin` | 打包一组工具 + 钩子 + 权限规则 |
| 钩子 | `HookCallback` | 审计日志、输入改写、工具拦截 |
| LLM | `LLMClient` | 接入其他模型供应商 |
| 记忆 | `Memory` | 自定义存储后端 |
| 向量 | `VectorStore` | Chroma / Pinecone 适配 |
| 权限 | `PermissionRule` | 自定义安全策略 |

---

## 8. 工程约定

- **模块系统**：ESM（`"type": "module"`），target `ES2022`，strict 模式，禁用 `any`。
- **OOP + DI**：所有组件构造函数注入，禁止服务定位器 / 全局单例（Config 除外，纯只读）。
- **命名**：类 PascalCase，方法 camelCase，工具名 snake_case（贴近 LLM 工具命名习惯）。
- **测试**：Vitest；单元测试 mock `LLMClient`；集成测试真实调用 GLM，env `MOCHIKIT_RUN_INTEGRATION=1` 控制。
- **凭证**：`dotenv` 加载 `BASE_URL` / `API_KEY` / `MODEL`；`.env` 不入库。
