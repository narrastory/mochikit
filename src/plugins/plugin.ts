/**
 * Plugin contract — a bundle of tools, hooks and permission rules installed
 * onto a host (typically an {@link Agent}).
 *
 * ## Motivation
 *
 * A MochiKit plugin is the unit of reuse.  Instead of wiring up tools,
 * hooks, and permission rules piecemeal on every agent, a plugin bundles
 * them into a single `install()` call.  Plugins can be shared as npm packages,
 * composed via {@link PluginRegistry}, and installed across many agents.
 *
 * ## Lifecycle
 *
 * 1. **Build**: Use {@link PluginBuilder} or implement {@link Plugin} directly.
 * 2. **Register**: Call `agent.use(plugin)` or `registry.install(plugin)`.
 * 3. **Apply**: The host calls each registration method during `install()`.
 *
 * There is no `uninstall()` — plugins are expected to be installed once during
 * agent construction and live for the agent's lifetime.
 */

import type { HookCallback, HookEvent } from '../core/hooks.js';
import type { PermissionRule } from '../core/permission.js';
import type { Tool } from '../core/tool.js';

/**
 * The receiver side of plugin installation.
 *
 * Any object that accepts tools, hooks, and permission rules implements this
 * interface.  The primary implementation is {@link Agent}, but
 * {@link PluginRegistry} also implements it to enable batched registration.
 */
export interface PluginHost {
  /**
   * Register a tool for dispatch during the agent loop.
   * @param tool - The tool to register.
   */
  registerTool(tool: Tool): void;

  /**
   * Register a lifecycle hook callback.
   * @param event - The hook event to listen for.
   * @param callback - The callback to invoke when the event fires.
   * @param priority - Execution priority (lower numbers run first, default 0).
   */
  registerHook(event: HookEvent, callback: HookCallback, priority?: number): void;

  /**
   * Register a permission rule in the agent's deny-list / allow-list pipeline.
   * @param rule - The permission rule to add.
   */
  registerPermissionRule(rule: PermissionRule): void;
}

/**
 * A named bundle of tools, hooks, and permission rules.
 *
 * Implementations call the appropriate `register*` methods on the host
 * during `install()`.  Plugins can be built fluently with
 * {@link PluginBuilder} or implemented as plain objects.
 */
export interface Plugin {
  /** Human-readable name for logging and debugging. */
  name: string;
  /**
   * Wire this plugin's components into the given host.
   * @param host - The receiver (an {@link Agent} or {@link PluginRegistry}).
   */
  install(host: PluginHost): void;
}

/**
 * A fluent builder for assembling a plugin from parts.
 *
 * ## Pattern
 *
 * `PluginBuilder` uses the **builder pattern**: each `.tool()`, `.hook()`,
 * and `.rule()` call records a registration action and returns `this` so
 * calls can be chained.  `.build()` freezes the accumulated actions into a
 * {@link Plugin} object.
 *
 * ## Usage
 *
 * ```ts
 * import { PluginBuilder } from "mochikit";
 *
 * const myPlugin = new PluginBuilder("my-plugin")
 *   .tool(new MyTool())
 *   .hook("PreToolUse", myHook, 10)
 *   .rule({ action: "allow", toolName: "my_tool" })
 *   .build();
 *
 * agent.use(myPlugin);
 * ```
 *
 * The builder does **not** install anything until `build()` is called and the
 * resulting plugin is passed to `Agent.use()` or
 * {@link PluginRegistry.install}.
 */
export class PluginBuilder {
  /** Accumulated registration actions — each is a closure that calls a register method on a host. */
  private parts: Array<(host: PluginHost) => void> = [];

  /**
   * @param name - The plugin's human-readable name (used in logs).
   */
  constructor(public readonly name: string) {}

  /**
   * Register a tool as part of this plugin.
   * @param t - The tool to add.
   * @returns `this` for chaining.
   */
  tool(t: Tool): this {
    this.parts.push((h) => h.registerTool(t));
    return this;
  }

  /**
   * Register a lifecycle hook callback.
   * @param event - The hook event to listen for (e.g. `"PreToolUse"`).
   * @param cb - The callback function.
   * @param priority - Execution order (lower runs first, default 0).
   * @returns `this` for chaining.
   */
  hook(event: HookEvent, cb: HookCallback, priority?: number): this {
    this.parts.push((h) => h.registerHook(event, cb, priority));
    return this;
  }

  /**
   * Register a permission rule.
   * @param rule - The permission rule to add to the agent's deny/allow pipeline.
   * @returns `this` for chaining.
   */
  rule(rule: PermissionRule): this {
    this.parts.push((h) => h.registerPermissionRule(rule));
    return this;
  }

  /**
   * Finalize the builder into an installable {@link Plugin}.
   *
   * The returned plugin captures a snapshot of all parts added so far.
   * Further calls to `tool()`, `hook()`, or `rule()` on the builder after
   * `build()` will **not** affect the already-built plugin.
   *
   * @returns An immutable-like {@link Plugin} object.
   */
  build(): Plugin {
    const parts = this.parts;
    const name = this.name;
    return {
      name,
      install(host: PluginHost): void {
        for (const p of parts) p(host);
      },
    };
  }
}
