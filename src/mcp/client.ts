/**
 * MCP Client Wrapper — a high-level, MochiKit-idiomatic wrapper around the
 * raw `@modelcontextprotocol/sdk` Client.
 *
 * ## Responsibilities
 *
 * - Manage the MCP **connection lifecycle** (connect → handshake → operate → disconnect).
 * - Expose a **simple, typed API** for tool discovery and invocation.
 * - Handle **errors gracefully** — MCP server failures should not crash the agent.
 * - Support **reconnection** for flaky remote servers.
 * - Provide a **connection timeout** so a hung server doesn't block the agent forever.
 *
 * ## Connection lifecycle
 *
 * ```
 *   new MCPClientWrapper(config)
 *   → wrapper.connect()           // spawn / dial → initialize handshake
 *   → wrapper.listTools()         // discover available tools
 *   → wrapper.callTool(name, args) // invoke a tool
 *   → wrapper.disconnect()        // close transport + client
 * ```
 *
 * After `disconnect()`, the wrapper can be reconnected via `reconnect()`.
 *
 * @module mcp/client
 */

import { createTransport } from './transport.js';
import type {
  MCPTransportConfig,
  McpSdkClient,
  McpSdkTransport,
  McpToolDefinition,
  McpCallToolResult,
} from './transport.js';

/**
 * A high-level wrapper around an MCP SDK client + transport pair.
 *
 * ## Usage
 *
 * ```ts
 * const wrapper = new MCPClientWrapper({
 *   type: 'stdio',
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
 * });
 *
 * await wrapper.connect();
 * const tools = await wrapper.listTools();
 * const result = await wrapper.callTool('read_file', { path: '/tmp/hello.txt' });
 * await wrapper.disconnect();
 * ```
 *
 * ## Error handling
 *
 * All methods catch errors from the underlying SDK and wrap them in
 * descriptive `Error` messages that include the server context.  This
 * makes debugging MCP connection issues much easier than raw SDK stack
 * traces.
 */
export class MCPClientWrapper {
  /** Human-readable label for logging (derived from transport config). */
  readonly label: string;

  /** The transport configuration used to create (and recreate) connections. */
  private config: MCPTransportConfig;

  /** The underlying SDK Client instance.  Set after `connect()`. */
  private client: McpSdkClient | null = null;

  /** The underlying SDK Transport instance.  Set after `connect()`. */
  private transport: McpSdkTransport | null = null;

  /** Whether the wrapper is currently connected and ready for tool calls. */
  private connected = false;

  /** Timeout in milliseconds for the `connect()` handshake. */
  private readonly connectTimeoutMs: number;

  /**
   * @param config - Transport configuration (stdio or streamable-http).
   * @param connectTimeoutMs - Maximum time (ms) to wait for the MCP handshake.
   *   Defaults to 10 seconds — generous enough for `npx` install on first run.
   */
  constructor(config: MCPTransportConfig, connectTimeoutMs = 10_000) {
    this.config = config;
    this.connectTimeoutMs = connectTimeoutMs;
    // Build a human-readable label for logging and error messages.
    if (config.type === 'stdio') {
      this.label = `stdio:${config.command} ${(config.args ?? []).join(' ')}`.trim();
    } else {
      this.label = `http:${config.url}`;
    }
  }

  /**
   * Connect to the MCP server and perform the initialization handshake.
   *
   * This method:
   * 1. Creates the transport (spawns subprocess or opens HTTP connection).
   * 2. Creates the SDK Client.
   * 3. Calls `client.connect(transport)` which performs the MCP
   *    `initialize` → `initialized` handshake.
   *
   * A connection timeout (default 10 s) prevents a hung or slow-starting
   * server from blocking the agent forever.
   *
   * @throws {Error} If the connection times out or the handshake fails.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      // Already connected — disconnect first to avoid resource leaks.
      await this.disconnect();
    }

    // Create the transport + client pair (synchronous — just instantiates
    // objects; no I/O yet).
    const { client, transport } = createTransport(this.config);
    this.client = client;
    this.transport = transport;

    try {
      await this.withTimeout(
        client.connect(transport),
        this.connectTimeoutMs,
        `MCP server "${this.label}" handshake timed out. ` +
          `The transport connected but the initialize handshake did not complete.`,
      );
    } catch (err) {
      // If connect fails, clean up the transport to avoid leaking processes
      // or connections.
      await this.safeClose();
      throw err;
    }

    this.connected = true;
  }

  /**
   * Discover the tools exposed by this MCP server.
   *
   * Calls the MCP `tools/list` method.  Returns an array of raw MCP tool
   * definitions — use {@link mcpToolsToMochiKit} from `tool-adapter.js` to
   * convert them into MochiKit {@link Tool} instances.
   *
   * @returns A promise resolving to the list of MCP tool definitions.
   * @throws {Error} If the client is not connected or the call fails.
   */
  async listTools(): Promise<McpToolDefinition[]> {
    this.requireConnected();
    const result = await this.client!.listTools();
    return result.tools;
  }

  /**
   * Call an MCP tool by name.
   *
   * Invokes the MCP `tools/call` method.  The result content items are
   * concatenated into a single string (text items joined by newlines;
   * non-text items are represented as JSON).
   *
   * @param toolName - The tool name (as returned by `tools/list`).
   * @param args - The tool arguments (key-value object).
   * @returns A string representation of the tool's output.
   * @throws {Error} If the client is not connected or the call fails.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    this.requireConnected();
    const result: McpCallToolResult = await this.client!.callTool({
      name: toolName,
      arguments: args,
    });

    // Serialize the result content items into a single string.
    return this.serializeToolResult(result);
  }

  /**
   * Gracefully disconnect from the MCP server.
   *
   * Closes the client first (which sends any necessary cleanup messages),
   * then closes the transport (which kills the subprocess or closes the
   * HTTP connection).
   *
   * Safe to call even if not connected — it's a no-op in that case.
   */
  async disconnect(): Promise<void> {
    await this.safeClose();
    this.connected = false;
  }

  /**
   * Reconnect to the MCP server.
   *
   * Equivalent to `disconnect()` followed by `connect()`.  Useful when a
   * remote server is restarted or a stdio process crashes.
   */
  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  /**
   * Whether the client is currently connected and ready for tool calls.
   */
  isConnected(): boolean {
    return this.connected;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Throw if the client is not connected.
   *
   * Every public method that requires a live connection calls this first to
   * produce a clear error message rather than an opaque null-reference crash.
   */
  private requireConnected(): void {
    if (!this.connected || !this.client) {
      throw new Error(
        `MCP server "${this.label}" is not connected. Call connect() first.`,
      );
    }
  }

  /**
   * Safely close the client and transport, ignoring any errors during cleanup.
   *
   * This is used both by `disconnect()` and by `connect()` when a handshake
   * fails (so we don't leak resources on a failed connection attempt).
   */
  private async safeClose(): Promise<void> {
    try {
      if (this.client) await this.client.close();
    } catch {
      // Ignore errors during client close — the transport may already be dead.
    }
    try {
      if (this.transport) await this.transport.close();
    } catch {
      // Ignore errors during transport close — the subprocess may already
      // have exited.
    }
    this.client = null;
    this.transport = null;
  }

  /**
   * Race a promise against a timeout, throwing a descriptive error on loss.
   *
   * Uses `AbortController` to signal cancellation where the underlying
   * operation supports it.  If the operation doesn't support AbortSignal,
   * the timeout still fires and rejects the promise, but the underlying
   * operation may continue running in the background until the process exits.
   *
   * @param promise - The async operation to race.
   * @param ms - Timeout in milliseconds.
   * @param message - Error message if the timeout fires.
   * @returns The resolved value of `promise` if it completes in time.
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Serialize a tool call result into a single string for the agent loop.
   *
   * The MCP spec allows tool results to contain multiple content items of
   * different types.  We handle:
   * - `"text"` items → extracted directly.
   * - `"image"` items → represented as `[Image: <mimeType>]` (base64 data
   *   is too large for the context window).
   * - `"resource"` items → JSON-serialized.
   * - Unknown types → JSON-serialized as a fallback.
   *
   * @param result - The raw `tools/call` result from the SDK.
   * @returns A string suitable for feeding back to the LLM.
   */
  private serializeToolResult(result: McpCallToolResult): string {
    // If the tool reported an error, prefix the output so the model knows
    // something went wrong.
    const parts: string[] = [];
    if (result.isError) {
      parts.push('[MCP tool reported an error]');
    }

    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        parts.push(item.text);
      } else if (item.type === 'image') {
        // Images can't be rendered in a text context.  Represent them as
        // a placeholder so the model knows the tool produced an image.
        parts.push(`[Image: ${item.mimeType ?? 'unknown'}]`);
      } else if (item.type === 'resource') {
        // Embedded resources: serialize as JSON for the model to inspect.
        parts.push(JSON.stringify(item));
      } else {
        // Fallback for unknown content types.
        parts.push(JSON.stringify(item));
      }
    }

    return parts.join('\n') || '(empty result)';
  }
}
