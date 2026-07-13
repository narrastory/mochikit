<p align="center">
  <img src="./assets/logo.svg" alt="MochiKit Logo" width="120" />
</p>

<h1 align="center">🍡 MochiKit</h1>
<p align="center">
  <em>A modern, plugin-driven TypeScript AI Agent framework.</em>
</p>

<p align="center">
  <a href="./README_ZH.md">🇨🇳 中文文档</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License MIT">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node >=18">
  <img src="https://img.shields.io/badge/typescript-strict-informational.svg" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/module-ESM-yellow.svg" alt="ESM">
  <img src="https://img.shields.io/badge/core%20files-44-lightgrey.svg" alt="44 core files">
</p>

---

> 🧠 **Core philosophy:** The complexity is in the harness, not the model. Every mechanism hangs off the same `LLM → tool_use → results → repeat` loop.

---

## Why MochiKit?

MochiKit is a **superbly concise** Node.js AI Agent framework. Compared to mainstream alternatives, it has extremely few core files and is remarkably easy to get started. The source code comes with **comprehensive English annotations**, making it an excellent introductory project for learning AI Agent architecture.

| | MochiKit | LangChain | CrewAI | AutoGen |
|---|---|---|---|---|
| **Core files** | **44** | 300+ | 200+ | 250+ |
| **Total source lines** | **~9,600** | 100,000+ | 50,000+ | 80,000+ |
| **Dependencies** | **3** | 20+ | 15+ | 10+ |
| **Learning curve** | **1 day** | 2 weeks | 1 week | 1 week |
| **TypeScript strict** | ✅ Zero `any` | ❌ | ❌ | ❌ |
| **Code annotations** | ✅ Full JSDoc | ❌ | ❌ | Partial |

---

## Features

- **🤖 Multi-Agent Collaboration** — Manager-Worker delegation, Sequential Chains, Team mailbox communication with protocol state machine
- **🔌 Plugin Architecture** — Bundle tools + hooks + permission rules into reusable plugins; install with `agent.use(plugin)`
- **📋 Skill Loading** — Declarative SKILL.md files; two-level loading (catalog in system prompt, full content on demand)
- **🧠 Unified Memory** — `Memory` interface with Markdown file storage (YAML frontmatter + index); auto-injection; consolidation/merge
- **🪝 Lifecycle Hooks** — `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` — priority-ordered, async, can block or rewrite
- **🔐 Permission Pipeline** — 3-gate pipeline: deny → rule → ask → resolver; built-in `AllowAllResolver` / `DenyAllResolver`
- **📦 Built-in Tools** — File I/O, Bash (sync + background), Web Search, Web Reader, TodoWrite, Memory, Task DAG, Team messaging
- **🔌 MCP Server Compatibility** — Connect to MCP servers via stdio or Streamable HTTP; tools are auto-discovered and namespaced as `mcp__<server>__<tool>`
- **⚡ Background Tasks** — Long-running bash commands run asynchronously; agent continues working
- **🛡️ Error Recovery** — Exponential backoff + jitter for 429/529, reactive compaction on `prompt_too_long`, fallback model failover
- **🌐 Multi-Provider** — Configure multiple LLM providers (GLM, OpenAI, Anthropic, DeepSeek…) in one `.env`; select per-agent via `loadConfig('provider')`
- **📐 Strict TypeScript** — Zero `any`, full type safety, OOP + dependency injection throughout
- **🧪 Fully Tested** — 135 unit tests (mock LLM) + 18 integration tests (real GLM)

---

## Installation

```bash
git clone https://github.com/MochiKit/MochiKit.git
cd MochiKit
npm install
cp .env.example .env   # Edit .env with your API key
```

**.env** — MochiKit uses the Anthropic-compatible protocol. Default endpoint is GLM (Zhipu):

```env
BASE_URL=https://open.bigmodel.cn/api/anthropic
API_KEY=your-api-key-here
MODEL=glm-4.7
MOCHIKIT_WEB_API_KEY=your-api-key-here
MOCHIKIT_RUN_INTEGRATION=0
```

> 💡 Any Anthropic-compatible endpoint works — just change `BASE_URL` and `MODEL`.

### Multi-Provider Configuration

Configure multiple LLM providers side-by-side using the `{NAME}_API_KEY` naming convention:

```env
# Default provider (no prefix)
API_KEY=your-glm-key
BASE_URL=https://open.bigmodel.cn/api/anthropic
MODEL=glm-4.7

# Named providers
DEEPSEEK_API_KEY=sk-your-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

OPENAI_API_KEY=sk-your-openai-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

Select a provider when loading config:

```ts
import { loadConfig } from 'mochikit';

const glmCfg    = loadConfig();           // default provider
const deepCfg   = loadConfig('deepseek'); // DeepSeek
const openaiCfg = loadConfig('openai');   // OpenAI
```

### MCP Server Integration

Connect to Model Context Protocol (MCP) servers and use their tools directly in your agents:

```ts
import { Agent, createMCPPlugin, AnthropicAdapter, loadConfig, PermissionManager, AllowAllResolver } from 'mochikit';

const cfg = loadConfig();

// Configure MCP servers — tools are auto-discovered
const mcp = createMCPPlugin({
  servers: [
    {
      name: 'filesystem',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
      permissionMode: 'auto-allow', // trust this server's tools
    },
  ],
});

const agent = new Agent({
  name: 'mcp-demo',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You have access to filesystem tools via MCP.',
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

agent.use(mcp.plugin);         // Install MCP tools
await mcp.init();               // Wait for connections (optional)

console.log(await agent.run('List files in /tmp'));
```

Tools are namespaced as `mcp__filesystem__read_file`, `mcp__filesystem__list_directory`, etc. —
no collisions with built-in tools. Supports both **stdio** (local subprocess) and
**Streamable HTTP** (remote server) transports.

---

## Quick Start

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

console.log(await agent.run('List the files in the current directory'));
```

Run it:

```bash
npx tsx your-file.ts
```

More examples:

```bash
npx tsx docs/examples/01-simple-agent.ts       # Single agent + file/bash tools
npx tsx docs/examples/02-manager-worker.ts     # Manager-Worker collaboration
npx tsx docs/examples/03-sequential-chain.ts   # Sequential chain + shared memory
npx tsx docs/examples/04-memory-and-vector.ts  # Markdown memory + vector store
npx tsx docs/examples/05-custom-plugin.ts      # Custom plugin: tools + hooks + rules
```

---

## Architecture

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

**Everything is constructor-injected** — swap any component without touching the loop.

For a detailed walkthrough, see the [Architecture Guide →](./docs/architecture.md).

---

## Documentation

| Language | Link | Description |
|---|---|---|
| 🇬🇧 English | [`docs/en/`](./docs/en/) | **Complete Developer Guide** — 19 chapters |
| 🇨🇳 中文 | [`docs/zh/`](./docs/zh/) | **完整开发者指南** — 19 章，从 Hello Agent 到端到端项目 |
| 📐 Architecture | [`docs/architecture.md`](./docs/architecture.md) | Architecture design with Mermaid diagrams |

### Chapter Index

| Ch | Topic |
|---|---|
| 01 | [Installation & Config](./docs/en/01-installation-and-config.md) |
| 02 | [First Agent](./docs/en/02-first-agent.md) |
| 03 | [Tool System](./docs/en/03-tool-system.md) |
| 04 | [Skill Loading](./docs/en/04-skill-loading.md) |
| 05 | [Memory System](./docs/en/05-memory-system.md) |
| 06 | [Vector Store](./docs/en/06-vector-store.md) |
| 07 | [Manager-Worker](./docs/en/07-manager-worker.md) |
| 08 | [Sequential Chain](./docs/en/08-sequential-chain.md) |
| 09 | [Team Messaging](./docs/en/09-team-messaging.md) |
| 10 | [Task System](./docs/en/10-task-system.md) |
| 11 | [Hooks](./docs/en/11-hooks.md) |
| 12 | [Permission](./docs/en/12-permission.md) |
| 13 | [Compaction & Recovery](./docs/en/13-compaction-and-recovery.md) |
| 14 | [Plugin System](./docs/en/14-plugin-system.md) |
| 15 | [Web Tools](./docs/en/15-web-tools.md) |
| 16 | [MCP Integration](./docs/en/16-mcp-integration.md) |
| 17 | [Config & Env Vars](./docs/en/17-config-and-env-vars.md) |
| 18 | [Testing Guide](./docs/en/18-testing-guide.md) |
| 19 | [Complete Example](./docs/en/19-complete-example.md) |

---

## Project Structure

```
MochiKit/
├── src/
│   ├── core/           # Agent loop, types, LLM adapter, hooks, permission, compaction, recovery
│   ├── collaboration/  # ManagerWorker, SequentialChain, Team, Subagent, Protocols
│   ├── memory/         # Memory interface, MarkdownMemory, VectorStore, InMemoryVectorStore
│   ├── infra/          # Config, MessageBus, TaskStore, SkillRegistry, BackgroundTaskManager
│   ├── tools/          # Built-in tools: fs, bash, web, memory, task, team, todo_write, skill
│   ├── plugins/        # Plugin interface, PluginBuilder, PluginRegistry
│   ├── mcp/            # MCP integration: transport, client, tool adapter, config, plugin
│   └── index.ts        # Barrel export (public API)
├── tests/
│   ├── unit/           # 22 test files (mock LLM, fast, no network)
│   ├── integration/    # 13 test files (real GLM, env-gated)
│   └── helpers/        # MockLLMClient, test fixtures
├── docs/
│   ├── en/             # English developer documentation (19 chapters)
│   ├── zh/             # Chinese developer documentation (19 chapters)
│   ├── examples/       # 5 runnable TypeScript examples
│   └── architecture.md # Architecture design document
├── assets/             # Logo and visual assets
└── skills/             # Bundled SKILL.md files
```

---

## Running Tests

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

---

## Contributing

MochiKit follows strict TypeScript with OOP + dependency injection. Every component is constructor-injected for testability.

1. Fork & clone
2. `npm install` + `cp .env.example .env`
3. Make changes — keep `tsc --noEmit` clean
4. Add tests — `npm run test:unit` must stay green
5. Open a PR

---

## License

MIT © 2024 MochiKit

---

<p align="center">
  <sub>Built with ❤️ using TypeScript · Anthropic SDK · GLM · Vitest</sub>
</p>
