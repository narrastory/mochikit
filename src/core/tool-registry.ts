/**
 * ToolRegistry — the dispatch map (tutorial s02) plus MCP-style namespace
 * isolation (tutorial s19): external/plugin tools are registered under a
 * `prefix__name` so they never collide with built-ins.
 *
 * ## Dispatch map pattern
 *
 * The registry is a `Map<string, Tool>` keyed by tool name.  When the agent
 * loop receives a {@link ToolUseBlock} from the model, it calls
 * {@link dispatch} which looks up the tool by name and executes it.  This is
 * the same pattern introduced in tutorial s02 but upgraded with namespace
 * isolation.
 *
 * ## Namespaced registration (collision prevention)
 *
 * Plugin tools (e.g. MCP servers) are registered via
 * {@link registerNamespaced}, which prepends a normalised namespace prefix:
 * `mcp__github__create_issue`.  The double-underscore separator is safe
 * because {@link normalizeName} strips any character outside `[A-Za-z0-9_-]`.
 * This guarantees that two plugins can never accidentally overwrite each
 * other's tools or clash with built-in tool names.
 */

import type { Tool, ToolContext } from './tool.js';
import type { ToolDefinition, ToolUseBlock } from './types.js';

/**
 * Central registry that maps tool names to {@link Tool} instances.
 *
 * Every tool must be registered before the agent loop starts.  The registry
 * is also the source of truth for {@link definitions} — the JSON-Schema list
 * sent to the model so it knows which tools are available.
 *
 * Registration is intentionally eager and fails fast on duplicate names.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /**
   * Register a tool under its own {@link ToolDefinition.name}.
   *
   * Throws if a tool with the same name is already registered — names must
   * be unique within a registry.
   *
   * @param tool - The tool to register.
   * @throws Error if a tool with the same name already exists.
   */
  register(tool: Tool): void {
    const name = tool.definition.name;
    if (this.tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }
    this.tools.set(name, tool);
  }

  /**
   * Register a tool under a namespaced name (e.g. `mcp__github__create_issue`).
   *
   * Both the namespace and the original tool name are normalised via
   * {@link normalizeName}, then joined with `__`.  The original tool is
   * wrapped so its definition carries the namespaced name.
   *
   * @param namespace - The namespace prefix (e.g. `"mcp__github"`).
   * @param tool - The tool to register under the namespaced name.
   */
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

  /**
   * Remove a tool by name.
   *
   * @param name - The exact tool name to unregister.
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Look up a tool by name.
   *
   * @param name - The tool name (exact match, including any namespace prefix).
   * @returns The {@link Tool} instance, or `undefined` if not found.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check whether a tool is registered.
   *
   * @param name - The tool name.
   * @returns `true` if the tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tools.
   *
   * @returns A new array of every {@link Tool} in the registry.
   */
  list(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * JSON-Schema definitions for every registered tool, to send to the model.
   *
   * This is the payload for the `tools` field of {@link LLMCreateParams}.
   * The model uses these definitions to decide when and how to emit
   * {@link ToolUseBlock} requests.
   *
   * @returns An array of {@link ToolDefinition} objects.
   */
  definitions(): ToolDefinition[] {
    return this.list().map((t) => t.definition);
  }

  /**
   * Dispatch a tool_use block, returning its result string.
   *
   * Looks up the tool by {@link ToolUseBlock.name}, executes it with the
   * block's input and the given context, and returns the result.  Unknown
   * tools and execution errors are caught and returned as error strings
   * rather than thrown, so the agent loop can feed them back to the model.
   *
   * @param block - The tool-use request from the model.
   * @param ctx - Runtime context passed to the tool's execute method.
   * @returns The tool's result string, or an error message string.
   */
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

/**
 * Replace any character outside [A-Za-z0-9_-] with underscore (tutorial s19).
 *
 * Used by {@link ToolRegistry.registerNamespaced} to ensure that namespace
 * prefixes and tool names form valid, collision-free compound keys.
 *
 * @param name - The raw name to normalise.
 * @returns The normalised name with only alphanumerics, underscores, and hyphens.
 */
export function normalizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}
