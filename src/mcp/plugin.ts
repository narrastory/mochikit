/**
 * MCP Plugin — the top-level integration point that connects MCP servers to
 * MochiKit agents.
 *
 * ## How it fits into MochiKit
 *
 * The MCP plugin is a standard MochiKit {@link Plugin} — it implements
 * `install(host)` and registers tools, permission rules, and hooks onto the
 * agent.  Users install it the same way they install any other plugin:
 *
 * ```ts
 * import { Agent, createMCPPlugin, loadConfig } from 'mochikit';
 *
 * const agent = new Agent({ ... });
 * const mcp = createMCPPlugin({
 *   servers: [
 *     {
 *       name: 'filesystem',
 *       transport: {
 *         type: 'stdio',
 *         command: 'npx',
 *         args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 *       },
 *     },
 *   ],
 * });
 *
 * agent.use(mcp.plugin);
 * // Optional: wait for all connections to complete before first run()
 * await mcp.init();
 * ```
 *
 * ## Architecture
 *
 * ```
 *   createMCPPlugin(config)
 *   ├── MCPClientWrapper (one per server)
 *   ├── mcpToolsToMochiKit()    ← adapts MCP tools → MochiKit Tools
 *   ├── host.registerTool()     ← namespaced as mcp__<server>__<tool>
 *   ├── host.registerPermissionRule() ← auto-allow prefix rule (optional)
 *   └── returns MCPSessionHandle (disconnectAll, reconnect, init)
 * ```
 *
 * ## Connection lifecycle
 *
 * MCP connections are **async** but `Plugin.install()` is **synchronous**.
 * The plugin fires off connection attempts in `install()` and tools are
 * registered in the `.then()` callback once each server responds to
 * `tools/list`.  If the user needs to ensure all tools are registered before
 * the first `agent.run()`, they can `await mcp.init()` which resolves when
 * all connection attempts have settled.
 *
 * ## Permission modes
 *
 * | Mode         | Behavior                                              |
 * |--------------|-------------------------------------------------------|
 * | `auto-allow` | Registers a `PermissionRule` that auto-allows all     |
 * |              | tools from this server (prefix match).  This is the   |
 * |              | default — safe for trusted local MCP servers.         |
 * | `manual`     | No auto-allow rule.  The agent's existing permission  |
 * |              | pipeline (rules, resolver) governs each tool call.    |
 * |              | Use this for untrusted remote servers.                |
 *
 * ## Tool lifecycle on disconnect
 *
 * When `disconnectAll()` is called, the transports are closed but the tools
 * remain registered.  If the model tries to call an MCP tool while the
 * transport is disconnected, the wrapper will return an error string (via
 * the caller's catch block), which is fed back to the model so it can
 * adapt.  This is intentional — tools are not unregistered because the
 * PluginHost interface does not expose unregistration.
 *
 * @module mcp/plugin
 */

import { MCPClientWrapper } from './client.js';
import { mcpToolsToMochiKit } from './tool-adapter.js';
import { loadMCPConfig } from './config.js';
import { normalizeName } from '../core/tool-registry.js';
import type { Plugin, PluginHost } from '../plugins/plugin.js';
import type { MCPConfig, MCPServerConfig } from './config.js';

/**
 * Handle returned by {@link createMCPPlugin} that allows the caller to manage
 * the lifecycle of MCP connections beyond what the plugin itself handles.
 */
export interface MCPSessionHandle {
  /** The plugin — pass this to `agent.use()`. */
  plugin: Plugin;

  /**
   * Promise that resolves when all initial MCP connections have settled
   * (either connected successfully or failed with an error).  The result
   * array contains one entry per server in the same order as the config.
   *
   * @returns Promise resolving to an array of connection results.
   */
  init(): Promise<MCPServerConnectionResult[]>;

  /**
   * Disconnect all MCP servers by closing their transports.
   *
   * The registered tools remain in the agent's ToolRegistry — if the model
   * tries to call one while the transport is disconnected, the wrapper
   * returns an error string that the model can react to.
   */
  disconnectAll(): Promise<void>;

  /**
   * Reconnect a specific server by name.
   *
   * Disconnects (if connected) and reconnects.  The tools remain registered
   * throughout — only the underlying transport is cycled.  Useful when a
   * remote server is restarted.
   *
   * @param serverName - The server name (as configured).
   */
  reconnect(serverName: string): Promise<void>;
}

/**
 * Result of a single MCP server connection attempt.
 */
export interface MCPServerConnectionResult {
  /** The server name (normalized). */
  serverName: string;
  /** Whether the connection succeeded. */
  success: boolean;
  /** Number of tools discovered (0 if connection failed). */
  toolCount: number;
  /** Error message if the connection failed. */
  error?: string;
}

/**
 * Create an MCP plugin from a configuration object.
 *
 * This is the primary entry point for MCP integration.  It creates
 * {@link MCPClientWrapper} instances for each configured server, discovers
 * tools, and registers them onto the agent with namespace isolation.
 *
 * ## Usage
 *
 * ```ts
 * const mcp = createMCPPlugin({
 *   servers: [
 *     {
 *       name: 'filesystem',
 *       transport: {
 *         type: 'stdio',
 *         command: 'npx',
 *         args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 *       },
 *       permissionMode: 'auto-allow',
 *     },
 *   ],
 * });
 *
 * agent.use(mcp.plugin);
 * await mcp.init();  // Wait for connections (optional)
 * ```
 *
 * @param config - MCP server configuration.
 * @returns An {@link MCPSessionHandle} with the plugin and lifecycle methods.
 */
export function createMCPPlugin(config: MCPConfig): MCPSessionHandle {
  // Validate and normalize the config.
  const validated = loadMCPConfig(config);

  // Wrappers are created but NOT connected until install() fires.
  const wrappers: MCPClientWrapper[] = [];
  for (const server of validated.servers) {
    wrappers.push(new MCPClientWrapper(server.transport));
  }

  // Connection results populated after init() settles.
  let connectionResults: MCPServerConnectionResult[] | null = null;
  let initPromise: Promise<MCPServerConnectionResult[]> | null = null;

  /**
   * Connect a single server and register its tools onto the host.
   *
   * This is called as a fire-and-forget async operation during install().
   * Errors are caught and logged rather than thrown, so one failing MCP
   * server does not prevent other servers from registering their tools.
   */
  async function connectAndRegister(
    serverConfig: MCPServerConfig,
    wrapper: MCPClientWrapper,
    host: PluginHost,
  ): Promise<MCPServerConnectionResult> {
    const safeName = normalizeName(serverConfig.name);
    const namespace = `mcp__${safeName}`;

    try {
      // Connect to the MCP server and discover its tools.
      await wrapper.connect();
      const mcpTools = await wrapper.listTools();

      // Adapt MCP tools to MochiKit Tool interface.
      // The caller closure captures `wrapper` so each tool call goes to
      // the correct server.  If the transport has been disconnected, the
      // wrapper throws and the adapter catches it, returning an error
      // string to the model.
      const caller = (toolName: string, args: Record<string, unknown>) =>
        wrapper.callTool(toolName, args);
      const tools = mcpToolsToMochiKit(safeName, mcpTools, caller);

      // Register each tool under the namespaced name.
      for (const tool of tools) {
        // Build the full namespaced name: mcp__<server>__<tool>
        const nsTool = `${namespace}__${normalizeName(tool.definition.name)}`;
        host.registerTool({
          definition: { ...tool.definition, name: nsTool },
          execute: tool.execute,
          isConcurrencySafe: tool.isConcurrencySafe,
        });
      }

      // Register auto-allow permission rule if configured.
      const permissionMode = serverConfig.permissionMode ?? 'auto-allow';
      if (permissionMode === 'auto-allow') {
        host.registerPermissionRule({
          name: `mcp-auto-allow:${safeName}`,
          // Use a custom check() with prefix matching because
          // PermissionRule.tools uses exact name matching, and we want to
          // match ALL tools from this server with one rule.
          check(ctx) {
            // Allow any tool whose name starts with the server namespace.
            // e.g. "mcp__filesystem__read_file" matches prefix "mcp__filesystem__"
            if (ctx.tool.name.startsWith(`${namespace}__`)) {
              return 'allow';
            }
            return 'passthrough';
          },
          reason: `Auto-allowed MCP tool from server "${safeName}"`,
        });
      }

      return {
        serverName: safeName,
        success: true,
        toolCount: mcpTools.length,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`MCP: failed to connect to server "${safeName}": ${msg}`);
      return {
        serverName: safeName,
        success: false,
        toolCount: 0,
        error: msg,
      };
    }
  }

  // Build the plugin that installs MCP tools onto the agent.
  const plugin: Plugin = {
    name: 'mcp',
    install(host: PluginHost): void {
      // Fire off all connection attempts in parallel.
      // Each one independently registers its tools on success.
      const attempts = validated.servers.map((serverConfig, i) =>
        connectAndRegister(serverConfig, wrappers[i], host),
      );

      initPromise = Promise.all(attempts).then((results) => {
        connectionResults = results;
        return results;
      });
    },
  };

  return {
    plugin,

    async init(): Promise<MCPServerConnectionResult[]> {
      if (connectionResults) return connectionResults;
      if (initPromise) return initPromise;
      // If init() is called before install(), return empty — there is nothing
      // to wait for.
      return [];
    },

    async disconnectAll(): Promise<void> {
      // Disconnect all wrappers (close transports).
      // Tools remain registered — if called while disconnected, the wrapper
      // returns an error string that the model can adapt to.
      await Promise.all(
        wrappers.map((w) => {
          try {
            return w.disconnect();
          } catch {
            // Ignore errors during disconnect — the server may already be dead.
          }
        }),
      );

      // Reset state so init() can be called again after reconnect.
      connectionResults = null;
      initPromise = null;
    },

    async reconnect(serverName: string): Promise<void> {
      const safeName = normalizeName(serverName);
      const idx = validated.servers.findIndex((s) => s.name === safeName);
      if (idx === -1) {
        throw new Error(
          `Unknown MCP server "${safeName}". Known servers: ${validated.servers.map((s) => s.name).join(', ')}`,
        );
      }

      // Cycle the transport: disconnect then reconnect.
      // Tools stay registered throughout.
      await wrappers[idx].disconnect();
      await wrappers[idx].connect();
    },
  };
}

/**
 * Convenience function: create an MCP plugin for a single server.
 *
 * Equivalent to:
 * ```ts
 * createMCPPlugin({ servers: [serverConfig] })
 * ```
 *
 * @param serverConfig - Configuration for a single MCP server.
 * @returns An {@link MCPSessionHandle} — same shape as {@link createMCPPlugin}.
 */
export function createMCPServerPlugin(
  serverConfig: MCPServerConfig,
): MCPSessionHandle {
  return createMCPPlugin({ servers: [serverConfig] });
}
