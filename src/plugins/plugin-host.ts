/**
 * PluginHost utilities — standalone host for sharing plugins across agents.
 */

import type { HookCallback, HookEvent } from '../core/hooks.js';
import type { PermissionRule } from '../core/permission.js';
import type { Tool } from '../core/tool.js';
import type { Plugin, PluginHost } from './plugin.js';

/** A host that records registrations so they can be replayed onto agents. */
export class PluginRegistry implements PluginHost {
  readonly tools: Tool[] = [];
  readonly hooks: Array<{ event: HookEvent; cb: HookCallback; priority?: number }> = [];
  readonly rules: PermissionRule[] = [];

  registerTool(tool: Tool): void {
    this.tools.push(tool);
  }

  registerHook(event: HookEvent, cb: HookCallback, priority?: number): void {
    this.hooks.push({ event, cb, priority });
  }

  registerPermissionRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  /** Install a plugin into this registry. */
  install(plugin: Plugin): this {
    plugin.install(this);
    return this;
  }

  /** Replay all registrations onto another host (e.g. an Agent). */
  applyTo(host: PluginHost): void {
    for (const t of this.tools) host.registerTool(t);
    for (const h of this.hooks) host.registerHook(h.event, h.cb, h.priority);
    for (const r of this.rules) host.registerPermissionRule(r);
  }
}
