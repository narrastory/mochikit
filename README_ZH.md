<p align="center">
  <img src="./assets/logo.svg" alt="MochiKit Logo" width="120" />
</p>

<h1 align="center">🍡 MochiKit</h1>
<p align="center">
  <em>一个现代、插件驱动的 TypeScript AI Agent 框架。</em>
</p>

<p align="center">
  <a href="./README.md">🇬🇧 English README</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License MIT">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node >=18">
  <img src="https://img.shields.io/badge/typescript-strict-informational.svg" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/module-ESM-yellow.svg" alt="ESM">
  <img src="https://img.shields.io/badge/%E6%A0%B8%E5%BF%83%E6%96%87%E4%BB%B6-44-lightgrey.svg" alt="44 核心文件">
</p>

---

> 🧠 **核心理念：** 复杂度在 Harness（ harness ），不在模型。所有机制都挂载在同一条 `LLM → tool_use → results → repeat` 循环上。

---

## 为什么选择 MochiKit？

MochiKit 是一个**极其简洁**的 Node.js AI Agent 框架。相比主流框架，它的核心文件数量极少，极易上手。源码配有**详尽的英文注释**，是学习 AI Agent 架构的绝佳入门项目。

| | MochiKit | LangChain | CrewAI | AutoGen |
|---|---|---|---|---|
| **核心文件数** | **44** | 300+ | 200+ | 250+ |
| **源码总行数** | **~9,600** | 100,000+ | 50,000+ | 80,000+ |
| **依赖数量** | **3** | 20+ | 15+ | 10+ |
| **上手时间** | **1 天** | 2 周 | 1 周 | 1 周 |
| **TypeScript 严格模式** | ✅ 零 `any` | ❌ | ❌ | ❌ |
| **代码注释** | ✅ 完整 JSDoc | ❌ | ❌ | 部分 |

---

## 特性

- **🤖 多智能体协同** — Manager-Worker 委托、顺序链（SequentialChain）、Team 信箱通信、协议状态机
- **🔌 插件架构** — 将工具 + 钩子 + 权限规则打包为可复用插件；一行 `agent.use(plugin)` 即可安装
- **📋 Skill 加载系统** — 声明式 SKILL.md 文件；两级加载（系统提示注入目录，按需加载完整内容）
- **🧠 统一记忆** — `Memory` 接口 + Markdown 文件存储（YAML frontmatter + 索引）；自动注入；合并去重
- **🪝 生命周期钩子** — `UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop` — 按优先级排序，支持异步，可阻断或改写
- **🔐 权限管道** — 三道闸门：deny → rule → ask → resolver；内置 `AllowAllResolver` / `DenyAllResolver`
- **📦 内置工具** — 文件读写、Bash（同步+后台）、Web 搜索、Web 阅读、TodoWrite、记忆、任务 DAG、Team 消息
- **🔌 MCP 服务兼容** — 通过 stdio 或 Streamable HTTP 连接 MCP 服务器；工具自动发现并以 `mcp__<server>__<tool>` 命名空间注册
- **⚡ 后台任务** — 长时间命令异步执行，Agent 继续工作，完成时收到通知
- **🛡️ 错误恢复** — 429/529 指数退避 + 抖动，`prompt_too_long` 反应式压缩，后备模型切换
- **🌐 多供应商** — 一个 `.env` 文件配置多个 LLM 供应商（GLM、OpenAI、Anthropic、DeepSeek…）；通过 `loadConfig('provider')` 按 Agent 选择
- **📐 严格 TypeScript** — 零 `any`，完整类型安全，全 OOP + 依赖注入
- **🧪 完整测试** — 135 个单元测试（mock LLM）+ 18 个集成测试（真实 GLM）

---

## 安装

```bash
git clone https://github.com/MochiKit/MochiKit.git
cd MochiKit
npm install
cp .env.example .env   # 编辑 .env 填入你的 API key
```

**.env** — MochiKit 使用 Anthropic 兼容协议，默认端点为 GLM（智谱）：

```env
BASE_URL=https://open.bigmodel.cn/api/anthropic
API_KEY=你的-api-key
MODEL=glm-4.7
MOCHIKIT_WEB_API_KEY=你的-api-key
MOCHIKIT_RUN_INTEGRATION=0
```

> 💡 任意兼容 Anthropic 协议的端点都能用，改 `BASE_URL` 和 `MODEL` 即可。

### 多供应商配置

通过 `{NAME}_API_KEY` 命名约定同时配置多个 LLM 供应商：

```env
# 默认供应商（无前缀）
API_KEY=你的-glm-key
BASE_URL=https://open.bigmodel.cn/api/anthropic
MODEL=glm-4.7

# 命名供应商
DEEPSEEK_API_KEY=sk-你的-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

OPENAI_API_KEY=sk-你的-openai-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

加载配置时选择供应商：

```ts
import { loadConfig } from 'mochikit';

const glmCfg    = loadConfig();           // 默认供应商
const deepCfg   = loadConfig('deepseek'); // DeepSeek
const openaiCfg = loadConfig('openai');   // OpenAI
```

---

## 快速开始

```ts
import {
  Agent, AnthropicAdapter, loadConfig,
  createBashTool, AllowAllResolver, PermissionManager,
} from 'mochikit';

const cfg = loadConfig();

const agent = new Agent({
  name: 'demo',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: '你是一个简洁的助手。',
  tools: [createBashTool()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

console.log(await agent.run('用 bash 列出当前目录的文件'));
```

运行：

```bash
npx tsx your-file.ts
```

更多示例：

```bash
npx tsx docs/examples/01-simple-agent.ts       # 单 Agent + 文件/bash 工具
npx tsx docs/examples/02-manager-worker.ts     # Manager-Worker 协同
npx tsx docs/examples/03-sequential-chain.ts   # 顺序链 + 共享记忆
npx tsx docs/examples/04-memory-and-vector.ts  # Markdown 记忆 + 向量存储
npx tsx docs/examples/05-custom-plugin.ts      # 自定义插件：工具 + 钩子 + 规则
```

---

## 架构

AgentLoop 是框架的核心：

```
用户输入 → [UserPromptSubmit 钩子] → while (turns < maxTurns):
  1. 压缩上下文 (budget → micro → snip)
  2. 调用 LLM 并重试 (429/529 退避, prompt_too_long → 反应式压缩)
  3. 若 end_turn → 返回文本
  4. 若 tool_use → 逐个工具：
       [PreToolUse 钩子] → [权限检查] → 执行 → [PostToolUse 钩子]
     → 将结果送回 → 循环
```

**所有组件都通过构造函数注入** — 不碰循环就能替换任意组件。

详细讲解请参阅 [架构设计文档 →](./docs/architecture.md)。

---

## 文档

| 语言 | 链接 | 说明 |
|---|---|---|
| 🇨🇳 中文 | [`docs/zh/`](./docs/zh/) | **完整开发者指南** — 19 章，从 Hello Agent 到端到端项目 |
| 🇬🇧 English | [`docs/en/`](./docs/en/) | **Complete Developer Guide** — 19 chapters |
| 📐 架构 | [`docs/architecture.md`](./docs/architecture.md) | 架构设计文档，含 Mermaid 图表 |

### 章节目录

| 章 | 标题 |
|---|---|
| 01 | [安装与配置](./docs/zh/01-安装与配置.md) |
| 02 | [第一个 Agent](./docs/zh/02-第一个Agent.md) |
| 03 | [工具系统](./docs/zh/03-工具系统.md) |
| 04 | [Skill 加载系统](./docs/zh/04-Skill加载系统.md) |
| 05 | [记忆系统](./docs/zh/05-记忆系统.md) |
| 06 | [向量存储](./docs/zh/06-向量存储.md) |
| 07 | [多智能体 — ManagerWorker](./docs/zh/07-多智能体-ManagerWorker.md) |
| 08 | [顺序链 — SequentialChain](./docs/zh/08-顺序链-SequentialChain.md) |
| 09 | [Team 与信箱通信](./docs/zh/09-Team与信箱通信.md) |
| 10 | [任务系统 — TaskStore](./docs/zh/10-任务系统-TaskStore.md) |
| 11 | [钩子 — Hooks](./docs/zh/11-钩子-Hooks.md) |
| 12 | [权限系统](./docs/zh/12-权限系统.md) |
| 13 | [上下文压缩与错误恢复](./docs/zh/13-上下文压缩与错误恢复.md) |
| 14 | [插件系统](./docs/zh/14-插件系统.md) |
| 15 | [Web 工具](./docs/zh/15-Web工具.md) |
| 16 | [MCP 集成](./docs/zh/16-MCP集成.md) |
| 17 | [配置与环境变量](./docs/zh/17-配置与环境变量.md) |
| 18 | [测试指南](./docs/zh/18-测试指南.md) |
| 19 | [完整实战示例](./docs/zh/19-完整实战示例.md) |

---

## 项目结构

```
MochiKit/
├── src/
│   ├── core/           # Agent 循环、类型、LLM 适配器、钩子、权限、压缩、恢复
│   ├── collaboration/  # ManagerWorker、SequentialChain、Team、Subagent、Protocols
│   ├── memory/         # Memory 接口、MarkdownMemory、VectorStore、InMemoryVectorStore
│   ├── infra/          # Config、MessageBus、TaskStore、SkillRegistry、BackgroundTaskManager
│   ├── tools/          # 内置工具：fs、bash、web、memory、task、team、todo_write、skill
│   ├── plugins/        # Plugin 接口、PluginBuilder、PluginRegistry
│   └── index.ts        # 桶导出（公共 API）
├── tests/
│   ├── unit/           # 22 个测试文件（mock LLM，快速，无需网络）
│   ├── integration/    # 13 个测试文件（真实 GLM，环境开关控制）
│   └── helpers/        # MockLLMClient、测试夹具
├── docs/
│   ├── en/             # 英文开发者文档（19 章）
│   ├── zh/ # 中文开发者文档（19 章）
│   ├── examples/       # 5 个可运行 TypeScript 示例
│   └── architecture.md # 架构设计文档
├── assets/             # Logo 及视觉资源
└── skills/             # 内置 SKILL.md 文件
```

---

## 运行测试

```bash
npm run typecheck          # 严格 TypeScript 类型检查（0 错误要求）
npm run test:unit          # 单元测试（mock LLM — 快速，无需网络，无需 API key）
npm run test:integration   # 集成测试（真实 GLM — 需 .env + MOCHIKIT_RUN_INTEGRATION=1）
npm test                   # 全部测试
```

```bash
# 运行单个测试文件
npx vitest run tests/unit/hooks.test.ts

# 使用真实 LLM 运行
MOCHIKIT_RUN_INTEGRATION=1 npx vitest run tests/integration
```

---

## 贡献

MochiKit 遵循严格 TypeScript + OOP + 依赖注入。所有组件通过构造函数注入以保证可测试性。

1. Fork & clone
2. `npm install` + `cp .env.example .env`
3. 修改代码 — 保持 `tsc --noEmit` 通过
4. 添加测试 — `npm run test:unit` 必须保持绿色
5. 提交 PR

---

<p align="center">
  <img src="./assets/c1.png" alt="pic" />
</p>

## 许可证

MIT © 2024 MochiKit

---

<p align="center">
  <sub>用 ❤️ 构建 · TypeScript · Anthropic SDK · GLM · Vitest</sub>
</p>
