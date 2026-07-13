/**
 * MCP Tool Adapter — bridges MCP tool definitions into MochiKit's
 * {@link Tool} interface so they can be registered in a {@link ToolRegistry}
 * and dispatched by the agent loop just like built-in tools.
 *
 * ## The adapter pattern
 *
 * MCP tools have a different shape than MochiKit tools:
 *
 * | Aspect        | MCP (`tools/list`)         | MochiKit (`Tool`)               |
 * |---------------|----------------------------|---------------------------------|
 * | Schema        | `inputSchema` (JSON Schema)| `definition.input_schema`       |
 * | Execution     | `tools/call` via transport | `execute(input, ctx)` async fn  |
 * | Error signal  | `isError` in result        | thrown Error / error string     |
 * | Metadata      | `description` string       | `description` + `[MCP:server]`  |
 *
 * The adapter translates between these two worlds.  The `caller` callback
 * keeps the adapter **decoupled from the transport** — unit tests can pass a
 * mock caller without spinning up a real MCP server.
 *
 * ## Naming convention
 *
 * Adapted tools are intended to be registered via
 * {@link ToolRegistry.registerNamespaced} with a namespace like
 * `mcp__<server>`.  This produces tool names such as:
 *
 * ```
 * mcp__filesystem__read_file
 * mcp__github__create_issue
 * mcp__deploy__trigger_deploy
 * ```
 *
 * The double-underscore separator is safe because MochiKit's
 * {@link normalizeName} strips everything outside `[A-Za-z0-9_-]`.
 *
 * @module mcp/tool-adapter
 */

import type { Tool, ToolContext } from '../core/tool.js';
import type { ToolDefinition } from '../core/types.js';
import type { McpToolDefinition } from './transport.js';

/**
 * Adapter a single MCP tool definition into a MochiKit {@link Tool}.
 *
 * The returned tool:
 * - Has a {@link ToolDefinition} derived from the MCP tool's `name`,
 *   `description`, and `inputSchema`.
 * - Tags the description with `[MCP:<serverName>]` so users can tell at a
 *   glance which MCP server provides the tool.
 * - Delegates execution to the `caller` callback, which should invoke
 *   `client.callTool(toolName, args)` on the appropriate MCP client.
 *
 * ## Error handling
 *
 * If the `caller` throws, the error message is returned as the tool result
 * (with an `[MCP Error]` prefix) rather than propagating the exception.
 * This follows MochiKit's convention of returning error strings from tool
 * dispatch rather than crashing the agent loop.
 *
 * @param serverName - Human-readable MCP server name (e.g. `"filesystem"`).
 *   Used in the `[MCP:<name>]` tag and for logging.
 * @param mcpTool - The raw tool definition from `tools/list`.
 * @param caller - A function that invokes the actual MCP tool call.
 *   Signature: `(toolName: string, args: Record<string, unknown>) => Promise<string>`.
 *   This decoupling allows unit tests to pass a mock caller.
 * @returns A MochiKit {@link Tool} object ready for registration.
 */
export function mcpToolToMochiKit(
  serverName: string,
  mcpTool: McpToolDefinition,
  caller: (toolName: string, args: Record<string, unknown>) => Promise<string>,
): Tool {
  // Build a MochiKit ToolDefinition from the MCP tool metadata.
  // The description is enriched with a [MCP:<server>] tag so users can
  // identify which server provides each tool in a multi-server setup.
  const description = mcpTool.description
    ? `[MCP:${serverName}] ${mcpTool.description}`
    : `[MCP:${serverName}] ${mcpTool.name}`;

  const inputSchema: Record<string, unknown> = mcpTool.inputSchema ?? {
    type: 'object',
    properties: {},
    required: [],
  };

  const definition: ToolDefinition = {
    name: mcpTool.name, // The original name — namespace is added by registerNamespaced().
    description,
    input_schema: inputSchema,
  };

  // Build the executor: delegate to the caller with the original tool name.
  // Errors are caught and formatted as error strings so they never crash
  // the agent loop.
  const execute = async (
    input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<string> => {
    try {
      return await caller(mcpTool.name, input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `[MCP Error — ${serverName}/${mcpTool.name}] ${msg}`;
    }
  };

  return {
    definition,
    execute,
    // MCP tools may have side effects (e.g. create_issue, trigger_deploy).
    // We conservatively mark them as NOT concurrency-safe so the agent loop
    // dispatches them sequentially.  This is the safe default.
    isConcurrencySafe: () => false,
  };
}

/**
 * Batch-convert all tools from an MCP server into MochiKit {@link Tool} instances.
 *
 * Convenience wrapper around {@link mcpToolToMochiKit} that processes an
 * entire `tools/list` response in one call.
 *
 * @param serverName - Human-readable MCP server name.
 * @param mcpTools - Array of tool definitions from `tools/list`.
 * @param caller - Tool invocation callback (see {@link mcpToolToMochiKit}).
 * @returns An array of MochiKit {@link Tool} objects, one per MCP tool.
 */
export function mcpToolsToMochiKit(
  serverName: string,
  mcpTools: McpToolDefinition[],
  caller: (toolName: string, args: Record<string, unknown>) => Promise<string>,
): Tool[] {
  return mcpTools.map((t) => mcpToolToMochiKit(serverName, t, caller));
}
