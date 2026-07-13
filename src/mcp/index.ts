/**
 * MCP (Model Context Protocol) module — connect MochiKit agents to
 * external tool servers via the standard MCP JSON-RPC protocol.
 *
 * ## Quick Start
 *
 * ```ts
 * import { Agent, createMCPPlugin } from 'mochikit';
 *
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
 * const agent = new Agent({ ... });
 * agent.use(mcp.plugin);
 * await mcp.init();
 * ```
 *
 * ## Module Map
 *
 * | Module         | Purpose                                              |
 * |----------------|------------------------------------------------------|
 * | `transport`    | Transport types + factory (`createTransport`)        |
 * | `client`       | `MCPClientWrapper` — high-level connection manager   |
 * | `tool-adapter` | Bridge MCP tools → MochiKit `Tool` interface         |
 * | `config`       | Configuration types + env-var loader                 |
 * | `plugin`       | `createMCPPlugin` — top-level Plugin integration     |
 *
 * @module mcp
 */

// Transport types and factory
export type {
  StdioTransportConfig,
  StreamableHttpTransportConfig,
  MCPTransportConfig,
  McpToolDefinition,
  McpToolsListResult,
  McpCallToolParams,
  McpCallToolResult,
  McpContentItem,
} from './transport.js';
export { createTransport } from './transport.js';

// Client wrapper
export { MCPClientWrapper } from './client.js';

// Tool adapter
export { mcpToolToMochiKit, mcpToolsToMochiKit } from './tool-adapter.js';

// Configuration
export type { MCPServerConfig, MCPConfig } from './config.js';
export { loadMCPConfig, loadMCPConfigFromEnv } from './config.js';

// Plugin (top-level integration)
export type { MCPSessionHandle, MCPServerConnectionResult } from './plugin.js';
export { createMCPPlugin, createMCPServerPlugin } from './plugin.js';
