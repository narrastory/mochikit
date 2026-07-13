/**
 * MochiKit — a modern, plugin-driven TypeScript AI Agent framework.
 *
 * Public API surface.  Re-exports are organized by module.
 *
 * ## Module Map
 *
 * | Section       | Purpose                                           |
 * |---------------|---------------------------------------------------|
 * | Core          | Agent loop, LLM client, tools, hooks, permissions |
 * | Collaboration | Manager-worker, chains, teams, sub-agents         |
 * | Memory        | Memory stores, vector stores                      |
 * | Infrastructure| Message bus, task store, config, skills           |
 * | Plugins       | Plugin builder, registry                          |
 * | Tools         | Built-in tool implementations                     |
 */

// ── Core ───────────────────────────────────────────────────────────
// The heart of MochiKit: the agent loop, LLM abstraction, tool system,
// lifecycle hooks, permission pipeline, context compaction, recovery,
// and the user-facing Agent class.

export * from './core/types.js';
export * from './core/llm-client.js';
export * from './core/tool.js';
export * from './core/tool-registry.js';
export * from './core/hooks.js';
export * from './core/permission.js';
export * from './core/context.js';
export * from './core/compaction.js';
export * from './core/recovery.js';
export * from './core/agent-loop.js';
export * from './core/agent.js';
export * from './core/system-prompt.js';

// ── Collaboration ───────────────────────────────────────────────────
// Multi-agent patterns: spawn subagents, chain agents sequentially,
// coordinate teams through a shared message bus.

export * from './collaboration/subagent.js';
export * from './collaboration/manager-worker.js';
export * from './collaboration/chain.js';
export * from './collaboration/team.js';
export * from './collaboration/protocols.js';

// ── Memory ──────────────────────────────────────────────────────────
// Persistent memory stores: filesystem-backed (MarkdownMemory),
// vector-backed semantic search (VectorStore, InMemoryVectorStore).

export * from './memory/memory.js';
export * from './memory/markdown-memory.js';
export * from './memory/vector-store.js';
export * from './memory/in-memory-vector-store.js';

// ── Infrastructure ──────────────────────────────────────────────────
// Cross-cutting infrastructure: message bus, task DAG store,
// configuration loader, skill registry, background task runner.

export * from './infra/message-bus.js';
export * from './infra/task-store.js';
export * from './infra/config.js';
export * from './infra/skill-registry.js';
export * from './infra/background-tasks.js';

// ── Plugins ─────────────────────────────────────────────────────────
// The plugin system: build reusable bundles of tools, hooks, and rules,
// then apply them to agents via PluginRegistry.

export * from './plugins/plugin.js';
export * from './plugins/plugin-host.js';

// ── MCP ─────────────────────────────────────────────────────────────
// Model Context Protocol integration: connect to MCP servers
// (local stdio subprocess or remote Streamable HTTP), discover tools,
// and register them as namespaced MochiKit tools.
// Servers can be local (stdio subprocess) or remote (Streamable HTTP).

export * from './mcp/index.js';

// ── Tools ───────────────────────────────────────────────────────────
// Built-in tool implementations: filesystem, shell, web, memory,
// task management, team communication, todo lists, and skill dispatch.

export * from './tools/fs.js';
export * from './tools/bash.js';
export * from './tools/web-reader.js';
export * from './tools/web-search.js';
export * from './tools/memory-tools.js';
export * from './tools/task-tools.js';
export * from './tools/team-tools.js';
export * from './tools/todo-write.js';
export * from './tools/skill-tools.js';
