/**
 * MCP Transport abstraction — wraps the `@modelcontextprotocol/sdk` transport
 * classes behind a simple factory function so the rest of MochiKit does not
 * need to know about SDK version differences or import paths.
 *
 * ## Supported transports (v1 scope)
 *
 * | Transport        | Use case                                  |
 * |------------------|-------------------------------------------|
 * | `stdio`          | Local MCP server spawned as a subprocess  |
 * | `streamable-http`| Remote MCP server accessed via HTTP + SSE  |
 *
 * Additional transports (WebSocket, SSE-only, in-process SDK) can be added
 * later by extending {@link MCPTransportConfig} and the factory without
 * changing any other module.
 *
 * ## SDK coupling
 *
 * This file is the **only module** that imports from
 * `@modelcontextprotocol/sdk`.  All other MochiKit modules use the
 * local interfaces defined below ({@link McpSdkClient}, {@link McpSdkTransport},
 * etc.).  This isolates SDK version changes to a single file.
 *
 * @module mcp/transport
 */

// ---------------------------------------------------------------------------
// Direct SDK imports — everything else uses the local interfaces below
// ---------------------------------------------------------------------------

import { Client as SdkClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ---------------------------------------------------------------------------
// Transport configuration types
// ---------------------------------------------------------------------------

/**
 * Configuration for a stdio-based MCP transport.
 *
 * The MochiKit host process spawns the MCP server as a child process and
 * communicates via JSON-RPC over stdin/stdout.  This is the most common
 * transport for local tools (filesystem, git, sqlite, etc.).
 */
export interface StdioTransportConfig {
  /** Discriminant for the factory. */
  type: 'stdio';
  /**
   * The command to spawn (e.g. `"node"`, `"python"`, `"npx"`).
   * Must be on the system PATH or an absolute path.
   */
  command: string;
  /**
   * Arguments passed to the command.
   * @example `["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]`
   */
  args?: string[];
  /**
   * Environment variables to merge with the parent process environment.
   * Useful for passing API keys to the MCP server subprocess.
   */
  env?: Record<string, string>;
}

/**
 * Configuration for a Streamable HTTP MCP transport.
 *
 * Connects to a remote MCP server over HTTP.  The server must support the
 * Streamable HTTP transport as defined in the MCP 2025-03-26 specification
 * (POST for client→server, optional GET SSE for server→client streaming).
 */
export interface StreamableHttpTransportConfig {
  /** Discriminant for the factory. */
  type: 'streamable-http';
  /**
   * Full URL of the MCP server endpoint.
   * @example `"http://localhost:3000/mcp"`
   */
  url: string;
  /**
   * Optional HTTP headers to include with every request (e.g. auth tokens).
   * @example `{ "Authorization": "Bearer sk-xxx" }`
   */
  headers?: Record<string, string>;
}

/**
 * Union of all supported transport configurations.
 *
 * The `type` discriminant determines which transport the factory creates.
 * Add new variants here when adding WebSocket, in-process SDK, etc.
 */
export type MCPTransportConfig = StdioTransportConfig | StreamableHttpTransportConfig;

// ---------------------------------------------------------------------------
// Local interfaces — a subset of the SDK's Client / Transport surface
// ---------------------------------------------------------------------------

/**
 * Minimal type for the MCP SDK `Client` class — only the methods we actually
 * call are declared.  This avoids propagating the SDK's complex generic type
 * parameters through the rest of MochiKit.
 *
 * The actual `SdkClient` has generic parameters `<RequestT, NotificationT, ResultT>`
 * which make it awkward to use as a plain type.  This interface captures the
 * runtime shape we depend on.
 */
export interface McpSdkClient {
  connect(transport: McpSdkTransport): Promise<void>;
  listTools(params?: { cursor?: string }): Promise<McpToolsListResult>;
  callTool(params: McpCallToolParams): Promise<McpCallToolResult>;
  close(): Promise<void>;
}

/**
 * Minimal type for any MCP SDK transport object.
 *
 * Both `StdioClientTransport` and `StreamableHTTPClientTransport` satisfy
 * this interface (they have `start()` and `close()` methods).
 */
export interface McpSdkTransport {
  start(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Shape of a single tool definition returned by `tools/list`.
 *
 * Matches the MCP specification: each tool has a name, optional description,
 * and a JSON Schema `inputSchema` describing its parameters.
 */
export interface McpToolDefinition {
  /** Unique tool name (within the server). */
  name: string;
  /** Human-readable description of what the tool does. */
  description?: string;
  /** JSON Schema for the tool's `arguments` object. */
  inputSchema?: Record<string, unknown>;
}

/**
 * Shape of the response from `client.listTools()`.
 */
export interface McpToolsListResult {
  /** Array of tool definitions exposed by the server. */
  tools: McpToolDefinition[];
  /** Pagination cursor — `undefined` if this is the last page. */
  nextCursor?: string;
}

/**
 * Parameters for `client.callTool()`.
 */
export interface McpCallToolParams {
  /** Name of the tool to invoke (must match a name from `tools/list`). */
  name: string;
  /** Tool arguments as an arbitrary key-value object. */
  arguments?: Record<string, unknown>;
}

/**
 * Shape of the response from `client.callTool()`.
 *
 * Per the MCP spec, the result contains an array of content items.  Each item
 * has a `type` field (`"text"`, `"image"`, `"resource"`, etc.) and
 * type-specific fields.
 */
export interface McpCallToolResult {
  /** Whether the tool execution reported an error. */
  isError?: boolean;
  /** Content items returned by the tool. */
  content: McpContentItem[];
}

/**
 * A single content item within a tool call result.
 *
 * For v1 we only handle `"text"` content items (the most common case).
 * Image and embedded resource items can be added later.
 */
export interface McpContentItem {
  /** Content type: `"text"`, `"image"`, `"resource"`, etc. */
  type: string;
  /** Text content (when `type === "text"`). */
  text?: string;
  /** MIME type (when `type === "image"` or `"resource"`). */
  mimeType?: string;
  /** Base64-encoded data (when `type === "image"` or `"resource"`). */
  data?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an MCP SDK transport + client pair from a MochiKit transport config.
 *
 * ## How it works
 *
 * 1. Instantiates the appropriate SDK transport class based on `config.type`.
 * 2. Instantiates the SDK `Client` class with MochiKit's identity.
 * 3. Returns both as a `{ client, transport }` pair.
 *
 * The caller is responsible for calling `client.connect(transport)` to
 * perform the MCP handshake and `client.close()` + `transport.close()` to
 * tear down the connection.
 *
 * ## Assertion note
 *
 * The SDK `Client` class has generic type parameters that are erased at
 * runtime.  We cast through `unknown` to fit our simpler {@link McpSdkClient}
 * interface.  This is safe because we only call the methods declared in
 * our interface and the SDK's runtime behavior matches.
 *
 * @param config - Transport configuration (stdio or streamable-http).
 * @returns An object with `client` (an {@link McpSdkClient}) and `transport`
 *          (an {@link McpSdkTransport}).
 */
export function createTransport(
  config: MCPTransportConfig,
): { client: McpSdkClient; transport: McpSdkTransport } {
  let transport: McpSdkTransport;

  if (config.type === 'stdio') {
    // Spawn the MCP server as a child process and communicate via stdin/stdout.
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    }) as unknown as McpSdkTransport;
  } else {
    // Connect to a remote MCP server over Streamable HTTP.
    // The SDK constructor accepts a URL object.
    transport = new StreamableHTTPClientTransport(
      new URL(config.url),
    ) as unknown as McpSdkTransport;
  }

  // Create the client with MochiKit's identity.
  // The MCP spec requires a client name and version for the initialize
  // handshake.
  //
  // Cast through `unknown` because the SDK's Client class is generic
  // (Client<RequestT, NotificationT, ResultT>) and we only need the
  // non-generic runtime interface declared in McpSdkClient.
  const client = new SdkClient(
    { name: 'mochikit', version: '0.1.0' },
  ) as unknown as McpSdkClient;

  return { client, transport };
}
