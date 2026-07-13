/**
 * MCP Configuration — load MCP server definitions from environment variables
 * or programmatic configuration objects.
 *
 * ## Environment variable convention
 *
 * MCP servers are declared using the `MCP__<SERVER>__*` naming pattern,
 * which mirrors MochiKit's existing `{NAME}_API_KEY` provider convention:
 *
 * ```env
 * # Local filesystem server via stdio
 * MCP__FILESYSTEM__TRANSPORT=stdio
 * MCP__FILESYSTEM__COMMAND=npx
 * MCP__FILESYSTEM__ARGS=-y @modelcontextprotocol/server-filesystem /tmp
 * MCP__FILESYSTEM__PERMISSION=auto-allow
 *
 * # Remote GitHub server via HTTP
 * MCP__GITHUB__TRANSPORT=streamable-http
 * MCP__GITHUB__URL=http://localhost:3000/mcp
 * MCP__GITHUB__HEADERS=Authorization:Bearer sk-xxx
 * ```
 *
 * Environment variables cannot express multiple servers behind a single name,
 * custom headers on stdio transports, or the full flexibility of programmatic
 * configuration.  For those use cases, use {@link MCPConfig} directly.
 *
 * ## Programmatic configuration
 *
 * For full control, construct an {@link MCPConfig} object and pass it to
 * {@link createMCPPlugin}:
 *
 * ```ts
 * const config: MCPConfig = {
 *   servers: [
 *     {
 *       name: 'filesystem',
 *       transport: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
 *       permissionMode: 'auto-allow',
 *     },
 *   ],
 * };
 * ```
 *
 * @module mcp/config
 */

import { normalizeName } from '../core/tool-registry.js';
import type { MCPTransportConfig, StdioTransportConfig, StreamableHttpTransportConfig } from './transport.js';

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Configuration for a single MCP server connection.
 *
 * Each server has a unique name (used as the namespace prefix in tool names),
 * a transport configuration, and an optional permission mode.
 */
export interface MCPServerConfig {
  /**
   * Unique name for this server instance.
   *
   * This name becomes the namespace prefix in MochiKit tool names:
   * `mcp__<name>__<tool>`.  Must be unique among all configured MCP servers
   * within a single plugin instance.
   *
   * The name is normalised via {@link normalizeName} so any characters
   * outside `[A-Za-z0-9_-]` are replaced with underscores.
   */
  name: string;

  /** Transport configuration — how to connect to this server. */
  transport: MCPTransportConfig;

  /**
   * Permission mode for this server's tools.
   *
   * - `"auto-allow"` (default): A permission rule is registered that auto-allows
   *   all tools from this server.  Use this for trusted local servers.
   * - `"manual"`: No auto-allow rule.  The agent's existing permission pipeline
   *   (including human-in-the-loop resolvers) governs each tool call.
   */
  permissionMode?: 'auto-allow' | 'manual';
}

/**
 * Top-level MCP configuration — a list of server definitions.
 *
 * Pass this to {@link createMCPPlugin} or construct it from environment
 * variables via {@link loadMCPConfigFromEnv}.
 */
export interface MCPConfig {
  /** Array of MCP server configurations.  Order does not matter. */
  servers: MCPServerConfig[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate and normalize an MCP configuration object.
 *
 * Performs the following checks:
 * - Duplicate server names (after normalization) are rejected.
 * - Transport `type` must be `"stdio"` or `"streamable-http"`.
 * - Stdio transport must have a non-empty `command`.
 * - Streamable HTTP transport must have a non-empty `url`.
 *
 * @param config - The raw configuration object.
 * @returns The same config (with normalized server names) if valid.
 * @throws {Error} If validation fails, with a descriptive message.
 */
export function loadMCPConfig(config: MCPConfig): MCPConfig {
  const seen = new Set<string>();

  for (const server of config.servers) {
    // Normalize the server name for consistent naming in the tool registry.
    const safeName = normalizeName(server.name);
    if (seen.has(safeName)) {
      throw new Error(
        `Duplicate MCP server name "${safeName}" (from "${server.name}"). ` +
          `Server names must be unique after normalization.`,
      );
    }
    seen.add(safeName);

    // Validate transport configuration.
    const t = server.transport;
    if (t.type === 'stdio') {
      if (!t.command || t.command.trim().length === 0) {
        throw new Error(
          `MCP server "${server.name}": stdio transport requires a non-empty "command" field.`,
        );
      }
    } else if (t.type === 'streamable-http') {
      if (!t.url || t.url.trim().length === 0) {
        throw new Error(
          `MCP server "${server.name}": streamable-http transport requires a non-empty "url" field.`,
        );
      }
    } else {
      throw new Error(
        `MCP server "${server.name}": unknown transport type "${(t as Record<string, unknown>).type}". ` +
          `Expected "stdio" or "streamable-http".`,
      );
    }

    // Normalize the name back onto the config so callers don't need to
    // re-normalize later.
    server.name = safeName;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Environment variable loading
// ---------------------------------------------------------------------------

/**
 * Parse MCP server configurations from environment variables.
 *
 * Scans `process.env` for variables matching the pattern
 * `MCP__<SERVER>__<KEY>` where `<SERVER>` is the server name and `<KEY>`
 * is one of `TRANSPORT`, `COMMAND`, `ARGS`, `URL`, `HEADERS`, `PERMISSION`.
 *
 * ## Variable reference
 *
 * | Variable                        | Required for          | Description                                |
 * |---------------------------------|-----------------------|--------------------------------------------|
 * | `MCP__<S>__TRANSPORT`           | Both                  | `"stdio"` or `"streamable-http"`           |
 * | `MCP__<S>__COMMAND`             | stdio                 | Command to spawn (e.g. `"npx"`)            |
 * | `MCP__<S>__ARGS`                | stdio                 | Space-separated arguments                  |
 * | `MCP__<S>__URL`                 | streamable-http       | Server endpoint URL                        |
 * | `MCP__<S>__HEADERS`             | streamable-http (opt) | `Key:Value` pairs separated by newline     |
 * | `MCP__<S>__PERMISSION`          | Both (opt)            | `"auto-allow"` (default) or `"manual"`     |
 *
 * @returns An {@link MCPConfig} object.  If no MCP environment variables are
 *          set, returns `{ servers: [] }` (empty config).
 *
 * @example
 * ```env
 * MCP__FILESYSTEM__TRANSPORT=stdio
 * MCP__FILESYSTEM__COMMAND=npx
 * MCP__FILESYSTEM__ARGS=-y @modelcontextprotocol/server-filesystem /tmp
 * ```
 *
 * ```ts
 * const config = loadMCPConfigFromEnv();
 * // → { servers: [{ name: 'filesystem', transport: { type: 'stdio', ... } }] }
 * ```
 */
export function loadMCPConfigFromEnv(): MCPConfig {
  // Regex: MCP__<SERVER>__<KEY>
  // SERVER: one or more uppercase letters, digits, or underscores
  // KEY: uppercase letters and digits
  const re = /^MCP__([A-Z][A-Z0-9_]*)__([A-Z][A-Z0-9_]*)$/;
  const serversMap = new Map<string, Record<string, string>>();

  // Group all MCP__ env vars by server name.
  for (const key of Object.keys(process.env)) {
    const m = key.match(re);
    if (!m) continue;
    const server = m[1];
    const field = m[2];
    const value = process.env[key] ?? '';
    if (!serversMap.has(server)) serversMap.set(server, {});
    serversMap.get(server)![field] = value;
  }

  // Parse each server group into an MCPServerConfig.
  const servers: MCPServerConfig[] = [];

  for (const [envName, fields] of serversMap) {
    const transportType = fields['TRANSPORT'];
    if (!transportType) {
      // No transport declared — skip this server group.
      continue;
    }

    const serverName = normalizeName(envName);
    const permissionMode =
      fields['PERMISSION'] === 'manual' ? 'manual' : 'auto-allow';

    let transport: MCPTransportConfig;

    if (transportType === 'stdio') {
      const command = fields['COMMAND'];
      if (!command) {
        // stdio requires a command — log a warning and skip.
        console.warn(
          `MCP: server "${envName}" has TRANSPORT=stdio but no COMMAND set. Skipping.`,
        );
        continue;
      }
      const argsStr = fields['ARGS'] ?? '';
      // Split args by whitespace, respecting quoted strings (basic support).
      const args = argsStr.length > 0 ? parseArgs(argsStr) : [];
      transport = {
        type: 'stdio',
        command,
        args,
      } satisfies StdioTransportConfig;
    } else if (transportType === 'streamable-http') {
      const url = fields['URL'];
      if (!url) {
        console.warn(
          `MCP: server "${envName}" has TRANSPORT=streamable-http but no URL set. Skipping.`,
        );
        continue;
      }
      const headers = parseHeaders(fields['HEADERS']);
      transport = {
        type: 'streamable-http',
        url,
        headers: headers.size > 0 ? Object.fromEntries(headers) : undefined,
      } satisfies StreamableHttpTransportConfig;
    } else {
      console.warn(
        `MCP: server "${envName}" has unknown TRANSPORT="${transportType}". ` +
          `Expected "stdio" or "streamable-http". Skipping.`,
      );
      continue;
    }

    servers.push({
      name: serverName,
      transport,
      permissionMode,
    });
  }

  return { servers };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a whitespace-separated argument string into an array.
 *
 * Supports double-quoted and single-quoted arguments.  This is a simplified
 * parser — it does not handle escaped quotes within arguments or nested
 * quoting.  For complex argument lists, use programmatic configuration instead.
 *
 * @param raw - The raw argument string.
 * @returns Array of parsed arguments.
 */
function parseArgs(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (const ch of raw) {
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else {
        current += ch;
      }
    } else if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inDouble = true;
      } else if (ch === "'") {
        inSingle = true;
      } else if (ch === ' ' || ch === '\t') {
        if (current.length > 0) {
          args.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

/**
 * Parse a header string into a Map.
 *
 * Headers can be separated by newlines or `|` characters, with each header
 * in `Key: Value` format.
 *
 * @param raw - The raw headers string (may be undefined).
 * @returns A Map of header name → value.
 */
function parseHeaders(raw: string | undefined): Map<string, string> {
  const headers = new Map<string, string>();
  if (!raw) return headers;

  // Split on newlines or pipe characters.
  const lines = raw.split(/[\n|]/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key && value) {
      headers.set(key, value);
    }
  }

  return headers;
}
