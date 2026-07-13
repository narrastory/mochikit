/**
 * Agent — the user-facing base class. Composes every core component via
 * dependency injection and drives an {@link AgentLoop}.
 *
 * ## Why Dependency Injection?
 *
 * Every component (LLM client, tool registry, hook manager, permission manager,
 * memory, message bus, task store, compaction pipeline) is passed through the
 * constructor rather than instantiated internally. This serves three goals:
 *
 * 1. **Testability** — unit tests can inject mock components
 *    (`MockLLMClient`, `AllowAllResolver`, etc.) without touching the agent.
 * 2. **Composability** — the caller controls which implementations to wire
 *    together, enabling different agent profiles from the same class.
 * 3. **No global singletons** — apart from the read-only `loadConfig()` cache,
 *    every piece of mutable state is owned by its injected instance.
 *
 * ## PluginHost Implementation
 *
 * `Agent` implements {@link PluginHost} so plugins can register tools, hooks,
 * and permission rules at runtime via `agent.use(plugin)`. The plugin system
 * uses a fluent `PluginBuilder` internally; `Agent` provides the concrete
 * registration surface (`registerTool`, `registerHook`, `registerPermissionRule`).
 *
 * ## Auto-Memory Injection
 *
 * When `autoMemory` is enabled and a `Memory` instance is provided, relevant
 * memories are queried before each `run()` call and prepended to the user input
 * as `<relevant_memories>` blocks. This gives the agent context about past
 * interactions without requiring the user to manually recall them.
 *
 * Also implements {@link PluginHost} so plugins can register tools, hooks and
 * permission rules onto a running agent.
 *
 * @module agent
 */

import { AgentLoop } from './agent-loop.js';
import type { AgentLoopOptions } from './agent-loop.js';
import { ConversationContext } from './context.js';
import type { CompactionPipeline } from './compaction.js';
import type { HookManager, HookCallback, HookEvent } from './hooks.js';
import { HookManager as HookManagerClass } from './hooks.js';
import type { LLMClient } from './llm-client.js';
import type { PermissionManager, PermissionRule } from './permission.js';
import { PermissionManager as PermissionManagerClass } from './permission.js';
import { ToolRegistry } from './tool-registry.js';
import type { Tool, ToolContext } from './tool.js';
import type { PluginHost } from '../plugins/plugin.js';
import type { Memory } from '../memory/memory.js';
import type { MessageBus } from '../infra/message-bus.js';
import type { TaskStore } from '../infra/task-store.js';
import type { PromptSection } from './system-prompt.js';
import { SkillRegistry } from '../infra/skill-registry.js';
import { BackgroundTaskManager } from '../infra/background-tasks.js';

// --- AgentOptions -------------------------------------------------------------

/**
 * Configuration for constructing an {@link Agent}.
 *
 * Every field is optional except `name`, `llm`, `model`, and `systemPrompt`.
 * Omitted optional fields receive sensible defaults (`HookManager`,
 * `PermissionManager` with deny-all resolver, `BackgroundTaskManager`).
 */
export interface AgentOptions {
  /** Human-readable name used in hooks, logs, and tool context. */
  name: string;
  /** LLM client adapter for making API calls. */
  llm: LLMClient;
  /** Model identifier string passed to the LLM client. */
  model: string;
  /**
   * Static system prompt. Used as the initial `ctx.system` value and as a
   * fallback when `systemSections` is not provided.
   */
  systemPrompt: string;
  /** Tools to register at construction time. */
  tools?: Tool[];
  /**
   * Memory backend for persistent knowledge (tutorial s09).
   * When set, it is passed to tools via `ToolContext.memory` and can be used
   * for auto-memory injection (see `autoMemory`).
   */
  memory?: Memory;
  /**
   * Message bus for inter-agent communication (collaboration patterns).
   * Passed to tools via `ToolContext.bus`.
   */
  bus?: MessageBus;
  /**
   * Task store for DAG-based task tracking (collaboration patterns).
   * Passed to tools via `ToolContext.tasks`.
   */
  tasks?: TaskStore;
  /** Pre-built hook manager. Defaults to a new `HookManager` if omitted. */
  hooks?: HookManager;
  /**
   * Pre-built permission manager. Defaults to a new `PermissionManager` with
   * deny-all resolver — tools will be blocked unless rules are registered.
   */
  permission?: PermissionManager;
  /** Pre-built compaction pipeline for context management. */
  compaction?: CompactionPipeline;
  /**
   * Maximum turns per `run()` call, forwarded to {@link AgentLoop}.
   * @default 30
   */
  maxTurns?: number;
  /**
   * Maximum tokens per LLM call, forwarded to {@link AgentLoop}.
   * @default 8192
   */
  maxTokens?: number;
  /**
   * Fallback model for sustained overload recovery, forwarded to
   * {@link AgentLoop} and {@link Recovery}.
   */
  fallbackModel?: string;
  /**
   * Working directory for tool execution. Defaults to `process.cwd()`.
   */
  cwd?: string;
  /**
   * Dynamic prompt sections assembled at runtime (tutorial s10).
   * When provided, these replace the static systemPrompt at assembly time.
   * The static systemPrompt is still used as the initial ctx.system value.
   */
  systemSections?: PromptSection[];
  /** Path to a skills/ directory for on-demand skill loading (tutorial s07). */
  skillsDir?: string;
  /** Manager for background command execution (tutorial s13). */
  backgroundTasks?: BackgroundTaskManager;
  /**
   * When true, auto-inject relevant memories into the conversation at
   * run start (tutorial s09). Requires `memory` to be set.
   */
  autoMemory?: boolean;
}

// --- Agent --------------------------------------------------------------------

/**
 * User-facing agent class — the primary entry point for MochiKit consumers.
 *
 * ## Usage
 *
 * ```ts
 * const agent = new Agent({
 *   name: 'my-agent',
 *   llm: new AnthropicAdapter({ apiKey: '...' }),
 *   model: 'glm-4-flash',
 *   systemPrompt: 'You are a helpful assistant.',
 *   tools: [myTool],
 *   autoMemory: true,
 *   memory: new MarkdownMemory('./memory'),
 * });
 * await agent.init();       // scan skills directory (if configured)
 * const result = await agent.run('Do the thing.');
 * ```
 *
 * ## Component Lifecycle
 *
 * - **Construction** — registers tools, creates/defaults HookManager,
 *   PermissionManager, ConversationContext, BackgroundTaskManager, and
 *   optionally SkillRegistry.
 * - **init()** — async; scans the skills directory if configured. Must be
 *   called before `run()`.
 * - **run()** — builds an {@link AgentLoopOptions} by mapping agent fields to
 *   loop fields, injects auto-memory if enabled, creates a fresh
 *   {@link AgentLoop}, and drives it.
 * - **reset()** — discards conversation history (keeps system prompt).
 *
 * ## Default Security Posture
 *
 * The default `PermissionManager` uses `DenyAllResolver` — every tool call is
 * blocked unless the caller registers allow rules via `registerPermissionRule()`
 * or a plugin. This is intentional: it forces the integrator to explicitly
 * declare what tools the agent may use.
 */
export class Agent implements PluginHost {
  /** Agent name from options. */
  readonly name: string;
  /** Active model identifier. */
  readonly model: string;
  /** Tool registry holding all registered tools. */
  readonly registry: ToolRegistry;
  /** Hook manager for lifecycle events. */
  readonly hooks: HookManager;
  /** Permission manager for tool-call authorization. */
  readonly permission: PermissionManager;
  /** Optional memory backend for persistent knowledge. */
  readonly memory?: Memory;
  /** Optional message bus for inter-agent communication. */
  readonly bus?: MessageBus;
  /** Optional task store for DAG-based task tracking. */
  readonly tasks?: TaskStore;
  /** Optional skill registry for on-demand skill loading (s07). */
  readonly skills?: SkillRegistry;
  /** Background task manager for async command execution. */
  readonly backgroundTasks: BackgroundTaskManager;
  /** Dynamic system prompt sections if configured. */
  readonly systemSections?: PromptSection[];
  /** Conversation context holding the message history. */
  protected ctx: ConversationContext;
  /** Raw options passed at construction time. */
  protected opts: AgentOptions;

  /**
   * @param opts — configuration for this agent instance.
   */
  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.name = opts.name;
    this.model = opts.model;
    this.memory = opts.memory;
    this.bus = opts.bus;
    this.tasks = opts.tasks;
    this.systemSections = opts.systemSections;
    this.registry = new ToolRegistry();
    for (const t of opts.tools ?? []) this.registry.register(t);
    this.hooks = opts.hooks ?? new HookManagerClass();
    this.permission = opts.permission ?? new PermissionManagerClass();
    this.ctx = new ConversationContext(opts.systemPrompt);

    // Skills (s07) — scan at construction time (scan itself is async, caller should await init()).
    // SkillRegistry.scan() is intentionally deferred to init() because it does I/O
    // (directory scanning); we only create the registry here so the field is available.
    if (opts.skillsDir) {
      this.skills = new SkillRegistry();
    }
    this.backgroundTasks = opts.backgroundTasks ?? new BackgroundTaskManager();
  }

  /**
   * Register a tool onto this agent.
   *
   * Tools registered after construction are immediately available for the
   * next `run()` call.
   *
   * @param tool — the tool instance to register.
   */
  registerTool(tool: Tool): void {
    this.registry.register(tool);
  }

  /**
   * Register a lifecycle hook callback.
   *
   * @param event — the hook event to listen for.
   * @param callback — the callback function.
   * @param priority — execution priority (lower runs first). Higher-priority
   *   hooks can short-circuit by returning a block/stop result.
   */
  registerHook(event: HookEvent, callback: HookCallback, priority?: number): void {
    this.hooks.on(event, callback, priority);
  }

  /**
   * Register a permission rule for tool-call authorization.
   *
   * Rules are evaluated in the PermissionManager's pipeline (deny → rule → ask).
   *
   * @param rule — the permission rule to add.
   */
  registerPermissionRule(rule: PermissionRule): void {
    this.permission.addRule(rule);
  }

  /**
   * Install a plugin onto this agent.
   *
   * The plugin's `install()` method receives `this` as the {@link PluginHost},
   * so it can call `registerTool`, `registerHook`, and `registerPermissionRule`.
   * Returns `this` for fluent chaining.
   *
   * @param plugin — a plugin object with a `name` and an `install` method.
   * @returns — `this` for chaining.
   */
  use(plugin: { name: string; install(host: PluginHost): void }): this {
    plugin.install(this);
    return this;
  }

  /**
   * Reset the conversation history to its initial state.
   *
   * Creates a fresh {@link ConversationContext} with the original system prompt.
   * All message history and tool results are discarded. Registered tools,
   * hooks, permissions, and memory are preserved.
   */
  reset(): void {
    this.ctx = new ConversationContext(this.opts.systemPrompt);
  }

  /**
   * Initialise async resources before the first `run()` call.
   *
   * Currently this scans the skills directory (if `skillsDir` was set).
   * Must be called and awaited before `run()`.
   *
   * @returns — a promise that resolves when initialisation is complete.
   */
  async init(): Promise<void> {
    if (this.opts.skillsDir && this.skills) {
      await this.skills.scan(this.opts.skillsDir);
    }
  }

  /**
   * Run the agent on a user input string.
   *
   * This is the main entry point for agent interaction. It:
   *
   * 1. Builds a `ToolContext` with memory, bus, tasks, and runtime references.
   * 2. If `autoMemory` is enabled, queries the memory backend for relevant
   *    entries and prepends them as `<relevant_memories>` blocks.
   * 3. Maps agent configuration into {@link AgentLoopOptions}.
   * 4. Creates a fresh {@link AgentLoop} and drives it.
   *
   * Each `run()` call creates a new `AgentLoop` instance, so per-run state
   * (turn counter, recovery state) does not leak across calls.
   *
   * @param input — the user's message string.
   * @returns — the final assistant text response.
   */
  async run(input: string): Promise<string> {
    const toolContextExtras: Partial<ToolContext> = {
      memory: this.memory,
      bus: this.bus,
      tasks: this.tasks,
      runtime: { agent: this, backgroundTasks: this.backgroundTasks },
    };

    // Auto-memory injection (s09): query relevant memories and prepend to input.
    // We query using the raw input before any memory context is injected,
    // so the similarity search is based on the user's original intent.
    // The injected memories are formatted as XML blocks for the LLM to parse.
    let effectiveInput = input;
    if (this.opts.autoMemory && this.memory) {
      const relevant = await this.memory.query(input, 3);
      if (relevant.length > 0) {
        const memBlock = relevant
          .map((e) => `[Memory: ${e.name}] ${e.body}`)
          .join('\n');
        effectiveInput = `<relevant_memories>\n${memBlock}\n</relevant_memories>\n\n${input}`;
      }
    }

    const loopOpts: AgentLoopOptions = {
      agentName: this.name,
      cwd: this.opts.cwd ?? process.cwd(),
      llm: this.opts.llm,
      model: this.model,
      ctx: this.ctx,
      tools: this.registry,
      hooks: this.hooks,
      permission: this.permission,
      compaction: this.opts.compaction,
      maxTurns: this.opts.maxTurns,
      maxTokens: this.opts.maxTokens,
      fallbackModel: this.opts.fallbackModel,
      toolContextExtras,
      systemSections: this.systemSections,
      backgroundTasks: this.backgroundTasks,
    };
    const loop = new AgentLoop(loopOpts);
    return loop.run(effectiveInput);
  }
}
