/**
 * PluginHost utilities — standalone host for sharing plugins across agents.
 *
 * ## Motivation
 *
 * When you have a set of plugins that should be installed on every agent
 * (e.g. a shared tool suite, organization-wide hooks, or standard permission
 * rules), {@link PluginRegistry} lets you register them once and replay the
 * registrations onto every new agent.  This avoids repetitive `agent.use()`
 * calls and ensures consistency.
 *
 * ## Pattern
 *
 * ```
 * const registry = new PluginRegistry();
 * registry.install(mcpPlugin).install(loggingPlugin);
 *
 * const agent1 = new Agent({ ... });
 * registry.applyTo(agent1);
 *
 * const agent2 = new Agent({ ... });
 * registry.applyTo(agent2);
 * ```
 *
 * The registry implements {@link PluginHost} itself, so it can be the target
 * of `agent.use()` or `plugin.install()`.  Registrations are recorded in
 * insertion order and replayed in that order during `applyTo()`.
 */

import type { HookCallback, HookEvent } from '../core/hooks.js';
import type { PermissionRule } from '../core/permission.js';
import type { Tool } from '../core/tool.js';
import type { Plugin, PluginHost } from './plugin.js';

/**
 * A host that records registrations so they can be replayed onto agents.
 *
 * ## Design
 *
 * `PluginRegistry` implements {@link PluginHost} — it accepts tool, hook, and
 * permission rule registrations just like an {@link Agent} does, but instead
 * of wiring them into an agent loop, it collects them in arrays.  Later,
 * `applyTo()` replays every recorded registration onto a real agent.
 *
 * This is the **registry pattern**: one central place to define the standard
 * toolkit, then "stamp" it onto every agent at construction time.
 *
 * ## Thread safety
 *
 * All methods mutate internal arrays.  Apply plugins to a registry before
 * spawning agents to avoid races.  Once `applyTo()` is called, the arrays
 * are read-only (the agent gets its own copies internally).
 */
export class PluginRegistry implements PluginHost {
  /** Tools registered in this registry, in insertion order. */
  readonly tools: Tool[] = [];
  /** Hooks registered in this registry, in insertion order. */
  readonly hooks: Array<{ event: HookEvent; cb: HookCallback; priority?: number }> = [];
  /** Permission rules registered in this registry, in insertion order. */
  readonly rules: PermissionRule[] = [];

  /**
   * Record a tool for later replay.
   * @param tool - The tool to register.
   */
  registerTool(tool: Tool): void {
    this.tools.push(tool);
  }

  /**
   * Record a hook callback for later replay.
   * @param event - The hook event to listen for.
   * @param cb - The callback function.
   * @param priority - Execution priority (lower runs first, default 0).
   */
  registerHook(event: HookEvent, cb: HookCallback, priority?: number): void {
    this.hooks.push({ event, cb, priority });
  }

  /**
   * Record a permission rule for later replay.
   * @param rule - The permission rule to add.
   */
  registerPermissionRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  /**
   * Install a plugin into this registry.
   *
   * The plugin's `install()` method is called with `this` as the host,
   * recording its tools, hooks, and rules in insertion order.  Returns
   * `this` so calls can be chained.
   *
   * @param plugin - The plugin to install.
   * @returns `this` for chaining.
   */
  install(plugin: Plugin): this {
    plugin.install(this);
    return this;
  }

  /**
   * Replay all registrations onto another host (e.g. an Agent).
   *
   * Registrations are replayed in the order they were recorded:
   * tools first, then hooks, then permission rules.  This ordering mirrors
   * the typical plugin lifecycle where tools are registered before hooks
   * that may reference them.
   *
   * Repeated calls to `applyTo()` on different agents are safe — each agent
   * gets its own internal copies of the registrations.
   *
   * @param host - The target agent or {@link PluginHost} to populate.
   */
  applyTo(host: PluginHost): void {
    for (const t of this.tools) host.registerTool(t);
    for (const h of this.hooks) host.registerHook(h.event, h.cb, h.priority);
    for (const r of this.rules) host.registerPermissionRule(r);
  }
}
