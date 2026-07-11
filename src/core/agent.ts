/**
 * Agent — the user-facing base class. Composes every core component via
 * dependency injection and drives an {@link AgentLoop}.
 *
 * Also implements {@link PluginHost} so plugins can register tools, hooks and
 * permission rules onto a running agent.
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

export interface AgentOptions {
  name: string;
  llm: LLMClient;
  model: string;
  systemPrompt: string;
  tools?: Tool[];
  memory?: Memory;
  bus?: MessageBus;
  tasks?: TaskStore;
  hooks?: HookManager;
  permission?: PermissionManager;
  compaction?: CompactionPipeline;
  maxTurns?: number;
  maxTokens?: number;
  fallbackModel?: string;
  cwd?: string;
}

export class Agent implements PluginHost {
  readonly name: string;
  readonly model: string;
  readonly registry: ToolRegistry;
  readonly hooks: HookManager;
  readonly permission: PermissionManager;
  readonly memory?: Memory;
  readonly bus?: MessageBus;
  readonly tasks?: TaskStore;
  protected ctx: ConversationContext;
  protected opts: AgentOptions;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    this.name = opts.name;
    this.model = opts.model;
    this.memory = opts.memory;
    this.bus = opts.bus;
    this.tasks = opts.tasks;
    this.registry = new ToolRegistry();
    for (const t of opts.tools ?? []) this.registry.register(t);
    this.hooks = opts.hooks ?? new HookManagerClass();
    this.permission = opts.permission ?? new PermissionManagerClass();
    this.ctx = new ConversationContext(opts.systemPrompt);
  }

  /** Register a tool onto this agent. */
  registerTool(tool: Tool): void {
    this.registry.register(tool);
  }

  registerHook(event: HookEvent, callback: HookCallback, priority?: number): void {
    this.hooks.on(event, callback, priority);
  }

  registerPermissionRule(rule: PermissionRule): void {
    this.permission.addRule(rule);
  }

  /** Install a plugin onto this agent. */
  use(plugin: { name: string; install(host: PluginHost): void }): this {
    plugin.install(this);
    return this;
  }

  /** Reset the conversation history (keeps system prompt). */
  reset(): void {
    this.ctx = new ConversationContext(this.opts.systemPrompt);
  }

  /** Run the agent on a user input; returns the final assistant text. */
  async run(input: string): Promise<string> {
    const toolContextExtras: Partial<ToolContext> = {
      memory: this.memory,
      bus: this.bus,
      tasks: this.tasks,
      runtime: { agent: this },
    };
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
    };
    const loop = new AgentLoop(loopOpts);
    return loop.run(input);
  }
}
