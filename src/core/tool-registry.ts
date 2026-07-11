/**
 * ToolRegistry — the dispatch map (tutorial s02) plus MCP-style namespace
 * isolation (tutorial s19): external/plugin tools are registered under a
 * `prefix__name` so they never collide with built-ins.
 */

import type { Tool, ToolContext } from './tool.js';
import type { ToolDefinition, ToolUseBlock } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }
    this.tools.set(name, tool);
  }

  /** Register a tool under a namespaced name (e.g. `mcp__github__create_issue`). */
  registerNamespaced(namespace: string, tool: Tool): void {
    const safeNs = normalizeName(namespace);
    const safeName = normalizeName(tool.definition.name);
    const full = `${safeNs}__${safeName}`;
    const namespaced: Tool = {
      definition: { ...tool.definition, name: full },
      execute: (input, ctx) => tool.execute(input, ctx),
      isConcurrencySafe: () => tool.isConcurrencySafe?.() ?? false,
    };
    this.register(namespaced);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** JSON-Schema definitions for every registered tool, to send to the model. */
  definitions(): ToolDefinition[] {
    return this.list().map((t) => t.definition);
  }

  /** Dispatch a tool_use block, returning its result string. */
  async dispatch(block: ToolUseBlock, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(block.name);
    if (!tool) {
      return `Error: unknown tool "${block.name}"`;
    }
    try {
      return await tool.execute(block.input ?? {}, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error executing "${block.name}": ${msg}`;
    }
  }
}

/** Replace any character outside [A-Za-z0-9_-] with underscore (tutorial s19). */
export function normalizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}
