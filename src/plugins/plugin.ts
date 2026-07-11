/**
 * Plugin contract — a bundle of tools, hooks and permission rules installed
 * onto a host (typically an {@link Agent}).
 */

import type { HookCallback, HookEvent } from '../core/hooks.js';
import type { PermissionRule } from '../core/permission.js';
import type { Tool } from '../core/tool.js';

export interface PluginHost {
  registerTool(tool: Tool): void;
  registerHook(event: HookEvent, callback: HookCallback, priority?: number): void;
  registerPermissionRule(rule: PermissionRule): void;
}

export interface Plugin {
  name: string;
  install(host: PluginHost): void;
}

/** A fluent builder for assembling a plugin from parts. */
export class PluginBuilder {
  private parts: Array<(host: PluginHost) => void> = [];
  constructor(public readonly name: string) {}

  tool(t: Tool): this {
    this.parts.push((h) => h.registerTool(t));
    return this;
  }

  hook(event: HookEvent, cb: HookCallback, priority?: number): this {
    this.parts.push((h) => h.registerHook(event, cb, priority));
    return this;
  }

  rule(rule: PermissionRule): this {
    this.parts.push((h) => h.registerPermissionRule(rule));
    return this;
  }

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
