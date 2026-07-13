# MochiKit Developer Documentation

MochiKit is a TypeScript + Node.js AI Agent development framework. This documentation is written for **everyday developers** with one goal: read it and start building. It does not cover the framework's internal architecture -- only how to install, how to use, and how to extend.

## Who This Documentation Is For

- Backend or full-stack developers who write TypeScript / JavaScript.
- Those who want to build AI Agents, multi-agent collaboration, and intelligent applications with memory and tools using code.
- You don't need to understand LLM internals -- just know how to call an API.

## Reading Order

We recommend reading the first 7 chapters in order, which will get you to a working multi-agent application. The rest can be referenced as needed.

| Chapter | Topic | What You'll Learn |
|---|---|---|
| [01-Installation & Config](01-installation-and-config.md) | Installation, environment variables | Get your first project running |
| [02-First Agent](02-first-agent.md) | Creating and running an Agent | Make an Agent answer questions |
| [03-Tool System](03-tool-system.md) | Built-in and custom tools | Make an Agent call code |
| [04-Skill Loading](04-skill-loading.md) | Declarative SKILL.md files | Load domain knowledge on demand |
| [05-Memory System](05-memory-system.md) | Markdown memory | Make an Agent remember facts |
| [06-Vector Store](06-vector-store.md) | Vector DB and semantic search | Plug in similarity search |
| [07-Manager-Worker](07-manager-worker.md) | Manager-Worker collaboration | Task delegation |
| [08-Sequential Chain](08-sequential-chain.md) | Chaining multiple Agents | Pipeline processing |
| [09-Team Messaging](09-team-messaging.md) | Multi-Agent async communication | Agents messaging each other |
| [10-Task System](10-task-system.md) | Task dependency graph | Decompose tasks with dependencies |
| [11-Hooks](11-hooks.md) | Lifecycle hooks | Audit, rewrite, intercept |
| [12-Permission](12-permission.md) | Tool execution permissions | Security control |
| [13-Compaction & Recovery](13-compaction-and-recovery.md) | Long conversations & stability | Avoid blowing up context |
| [14-Plugin System](14-plugin-system.md) | Packaging reusable capabilities | Write once, reuse everywhere |
| [15-Web Tools](15-web-tools.md) | Web search and reading | Let your Agent browse the web |
| [16-MCP Integration](16-mcp-integration.md) | MCP server compatibility | Connect to local/remote tool servers |
| [17-Config & Env Vars](17-config-and-env-vars.md) | All configuration options | Flexible deployment |
| [18-Testing Guide](18-testing-guide.md) | Writing tests | Quality assurance |
| [19-Complete Example](19-complete-example.md) | Comprehensive hands-on | Tie everything together |

## Conventions

- All code examples are complete, copy-pasteable TypeScript.
- Run examples with: `npx tsx your-file.ts`.
- Import paths use the package name `mochikit` (when published) or relative paths like `../src` (when using source directly).
- The framework defaults to GLM (Zhipu) Anthropic-compatible endpoints, and can also be used with any Anthropic-protocol endpoint.

## Quick Look

```ts
import { Agent, AnthropicAdapter, loadConfig, createBashTool, AllowAllResolver, PermissionManager } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'demo',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You are a concise assistant.',
  tools: [createBashTool()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});
console.log(await agent.run('List the files in the current directory using bash'));
```

See the individual chapters for more.
