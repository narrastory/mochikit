<p align="center">
  <h1 align="center">🍡 MochiKit</h1>
  <p align="center">
    <em>A modern, plugin-driven TypeScript AI Agent framework.</em>
    <br>
    Multi-agent collaboration · Unified memory · Pluggable infrastructure.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License MIT">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node >=18">
  <img src="https://img.shields.io/badge/typescript-strict-informational.svg" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/module-ESM-yellow.svg" alt="ESM">
</p>

---

**MochiKit** is a batteries-included framework for building AI agents in TypeScript. It gives you a production-ready harness — multi-agent orchestration, tool dispatch, lifecycle hooks, permission gating, context compaction, error recovery — so you can focus on your agent's behavior, not the plumbing.

> 🧠 **Core philosophy:** The complexity is in the harness, not the model. Every mechanism hangs off the same `LLM → tool_use → results → repeat` loop.

---

## ✨ Features

- **🤖 Multi-Agent Collaboration** — Manager-Worker delegation, Sequential Chains, Team mailbox communication with protocol state machine, isolated sub-agents
- **🔌 Plugin Architecture** — Bundle tools + hooks + permission rules into reusable plugins; install with `agent.use(plugin)`
- **📋 Skill Loading** — Declarative SKILL.md files; two-level loading (catalog in system prompt, full content on demand)
- **🧠 Unified Memory** — `Memory` interface with Markdown file storage (YAML frontmatter + index); auto-injection of relevant memories; consolidation/merge; `VectorStore` with cosine similarity
- **🪝 Lifecycle Hooks** — `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` — priority-ordered, async, can block or rewrite
- **🔐 Permission Pipeline** — 3-gate pipeline: deny → rule → ask → resolver; built-in `AllowAllResolver` / `DenyAllResolver`
- **📦 Built-in Tools** — File I/O, Bash (sync + background), Web Search, Web Reader, TodoWrite (in-conversation planning), Memory, Task DAG, Team messaging
- **⚡ Background Tasks** — Long-running bash commands run asynchronously; agent continues working, gets notified on completion
- **🛡️ Error Recovery** — Exponential backoff + jitter for 429/529, reactive compaction on `prompt_too_long`, fallback model failover
- **📐 Strict TypeScript** — Zero `any`, full type safety, OOP + dependency injection throughout
- **🧪 Fully Tested** — 38 unit tests (mock LLM) + 10 integration tests (real GLM-4.7), documented in Chinese & English

---

## 📦 Installation

```bash
git clone https://github.com/YOUR_USERNAME/MochiKit.git
cd MochiKit
npm install
cp .env.example .env   # Edit .env with your API key
```

**.env** — MochiKit uses the Anthropic-compatible protocol. Default endpoint is GLM (Zhipu):

```env
BASE_URL=https://open.bigmodel.cn/api/anthropic
API_KEY=your-api-key-here
MODEL=glm-4.7
MOCHIKIT_WEB_API_KEY=your-api-key-here   # for web_search / web_reader tools
MOCHIKIT_RUN_INTEGRATION=0               # set to 1 to run real-LLM integration tests
```

> 💡 Any Anthropic-compatible endpoint works — just change `BASE_URL` and `MODEL`.

---

## 🚀 Quick Start

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
  systemPrompt: 'You are a helpful assistant. Be concise.',
  tools: [createBashTool()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

console.log(await agent.run('用 bash 列出当前目录的文件'));
```

Run it:

```bash
npx tsx your-file.ts
```

More examples:

```bash
npx tsx examples/01-simple-agent.ts          # Single agent + file/bash tools
npx tsx examples/02-manager-worker.ts        # Manager-Worker collaboration
npx tsx examples/03-sequential-chain.ts      # Sequential chain + shared memory
npx tsx examples/04-memory-and-vector.ts     # Markdown memory + vector store
npx tsx examples/05-custom-plugin.ts         # Custom plugin: tools + hooks + rules
```

---

## 📖 Documentation

| Document | Language | Description |
|---|---|---|
| [`mochikit开发文档/`](mochikit开发文档/) | 🇨🇳 中文 | **Complete developer guide** — 17 chapters from "Hello Agent" to end-to-end projects |
| [`docs/usage-guide.md`](docs/usage-guide.md) | 🇬🇧 English | Quick-reference usage guide |
| [`Design/Architecture_Design.md`](Design/Architecture_Design.md) | 🇬🇧 English | Architecture overview, module breakdown, core interfaces, data flow |

**中文文档目录** (`mochikit开发文档/`)：

| Chapter | Topic |
|---|---|
| 01 | 安装与配置 |
| 02 | 第一个 Agent |
| 03 | 工具系统（内置 + 自定义 + TodoWrite + 后台） |
| 03b | Skill 加载系统（声明式知识注入） |
| 04 | 记忆系统（MarkdownMemory + 自动注入 + 合并） |
| 05 | 向量存储（InMemory + Chroma/Pinecone 契约） |
| 06 | 多智能体 — Manager-Worker |
| 07 | 顺序链 — SequentialChain |
| 08 | Team 与信箱通信 |
| 09 | 任务系统 — TaskStore DAG |
| 10 | 钩子 — Hooks |
| 11 | 权限系统 |
| 12 | 上下文压缩与错误恢复 |
| 13 | 插件系统 |
| 14 | Web 工具 |
| 15 | 配置与环境变量 |
| 16 | 测试指南 |
| 17 | 完整实战示例 |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MochiKit Framework                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Collaboration Layer                           │  │
│  │    ManagerWorker · SequentialChain · Team · Subagent       │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴──────────────────────────────────┐  │
│  │                    Core Engine                             │  │
│  │                                                            │  │
│  │   AgentLoop ── while (turns < maxTurns):                  │  │
│  │     compact → withRetry(LLM) → dispatch tools → repeat    │  │
│  │                                                            │  │
│  │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐   │  │
│  │   │ Recovery │ │  Hooks   │ │Permission│ │Compaction │   │  │
│  │   │ (retry)  │ │(4 events)│ │ (3-gate) │ │ (layered) │   │  │
│  │   └──────────┘ └──────────┘ └──────────┘ └───────────┘   │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴──────────────────────────────────┐  │
│  │                  Infrastructure                            │  │
│  │    Memory (Markdown) · VectorStore (InMemory/Cosine)       │  │
│  │    MessageBus (InMemory/JSONL) · TaskStore (DAG)          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴──────────────────────────────────┐  │
│  │              Tools & Plugins                               │  │
│  │   fs · bash · web_search · web_reader · memory · task     │  │
│  │   PluginBuilder · PluginHost · PluginRegistry             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

The AgentLoop is the heart of the framework:

```
User Input → [UserPromptSubmit hooks] → while (turns < maxTurns):
  1. Compact context (budget → micro → snip)
  2. Call LLM with retry (429/529 backoff, prompt_too_long → reactive compact)
  3. If end_turn → return text
  4. If tool_use → for each tool:
       [PreToolUse hooks] → [Permission check] → execute → [PostToolUse hooks]
     → feed results back → loop
```

Everything is constructor-injected — swap any component without touching the loop.

---

## 📂 Project Structure

```
MochiKit/
├── src/
│   ├── core/           # Agent loop, types, LLM adapter, hooks, permission,
│   │                   # compaction, recovery, system-prompt assembly, tool registry
│   ├── collaboration/  # ManagerWorker, SequentialChain, Team, Subagent, Protocols
│   ├── memory/         # Memory interface, MarkdownMemory (consolidation), VectorStore
│   ├── infra/          # MessageBus (InMemory/JSONL), TaskStore (DAG),
│   │                   # SkillRegistry, BackgroundTaskManager, Config (dotenv)
│   ├── tools/          # Built-in tools: fs, bash (sync+bg), web, memory,
│   │                   # task, team, todo_write, skill loading
│   ├── plugins/        # Plugin interface, PluginBuilder, PluginRegistry
│   └── index.ts        # Barrel export (public API)
├── tests/
│   ├── unit/           # 12 test files (mock LLM, fast, no network)
│   ├── integration/    # 9 test files (real GLM, env-gated)
│   └── helpers/        # MockLLMClient, test fixtures
├── examples/           # 5 runnable TypeScript examples
├── mochikit开发文档/    # Chinese developer documentation (17 chapters)
├── docs/               # English quick-reference guide
├── Design/             # Architecture design document
└── _archive/           # Reference materials (tutorial source, API docs, test report)
```

---

## 🔧 Running Tests

```bash
npm run typecheck          # Strict TypeScript type checking (0 errors required)
npm run test:unit          # Unit tests (mock LLM — fast, no network, no API key)
npm run test:integration   # Integration tests (real GLM — needs .env + MOCHIKIT_RUN_INTEGRATION=1)
npm test                   # All tests
```

```bash
# Run a single test file
npx vitest run tests/unit/hooks.test.ts

# Run with real LLM
MOCHIKIT_RUN_INTEGRATION=1 npx vitest run tests/integration
```

Test coverage: **38 unit tests** + **10 integration tests** (3-round verified, 100% pass rate against GLM-4.7).

---

## 🤝 Contributing

MochiKit follows strict TypeScript with OOP + dependency injection. Every component is constructor-injected for testability.

1. Fork & clone
2. `npm install` + `cp .env.example .env`
3. Make changes — keep `tsc --noEmit` clean
4. Add tests — `npm run test:unit` must stay green
5. Open a PR

---

## 📄 License

MIT © 2024

---

<p align="center">
  <sub>Built with ❤️ using TypeScript · Anthropic SDK · GLM · Vitest</sub>
</p>
