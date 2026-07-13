# 18 - MCP Integration

In this chapter you will learn how to connect MochiKit agents to MCP (Model Context Protocol) servers — giving your agents access to tools from external services without writing custom tool code.

## 1. What is MCP?

**MCP (Model Context Protocol)** is an open standard that lets AI agents discover and use tools from external servers. An MCP server exposes tools via a JSON-RPC interface — the agent discovers what tools are available (`tools/list`) and calls them when needed (`tools/call`).

MochiKit supports two transport methods:

| Transport | Use Case | Example |
|---|---|---|
| **stdio** | Local MCP server (subprocess) | Filesystem tools, git tools, SQLite |
| **Streamable HTTP** | Remote MCP server | GitHub API, Jira, internal services |

When MCP tools are registered, they are **namespaced** as `mcp__<server>__<tool>` — so `read_file` from a server named `filesystem` becomes `mcp__filesystem__read_file`. This prevents name collisions between servers and with built-in tools.

## 2. Configuration

### 2.1 Programmatic Configuration

Pass a config object directly to `createMCPPlugin`:

```ts
import { createMCPPlugin } from 'mochikit';

const mcp = createMCPPlugin({
  servers: [
    {
      name: 'filesystem',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
      permissionMode: 'auto-allow', // trust this server's tools
    },
    {
      name: 'github',
      transport: {
        type: 'streamable-http',
        url: 'http://localhost:3000/mcp',
        headers: { Authorization: 'Bearer sk-xxx' },
      },
      permissionMode: 'manual', // go through permission checks
    },
  ],
});
```

### 2.2 Environment Variable Configuration

Declare MCP servers in `.env` and use `loadMCPConfigFromEnv()`:

```env
# Local filesystem server via stdio
MCP__FILESYSTEM__TRANSPORT=stdio
MCP__FILESYSTEM__COMMAND=npx
MCP__FILESYSTEM__ARGS=-y @modelcontextprotocol/server-filesystem /tmp
MCP__FILESYSTEM__PERMISSION=auto-allow

# Remote GitHub server via HTTP
MCP__GITHUB__TRANSPORT=streamable-http
MCP__GITHUB__URL=http://localhost:3000/mcp
MCP__GITHUB__HEADERS=Authorization: Bearer sk-xxx
MCP__GITHUB__PERMISSION=manual
```

```ts
const mcp = createMCPPlugin(loadMCPConfigFromEnv());
```

### 2.3 MCPServerConfig Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Yes | Unique server name; becomes the namespace prefix |
| `transport` | `MCPTransportConfig` | Yes | How to connect (`stdio` or `streamable-http`) |
| `permissionMode` | `'auto-allow' \| 'manual'` | No | Default `'auto-allow'` |

**StdioTransportConfig**:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `'stdio'` | Yes | Transport type |
| `command` | `string` | Yes | Command to spawn (e.g. `npx`, `python`) |
| `args` | `string[]` | No | Arguments for the command |
| `env` | `Record<string, string>` | No | Extra environment variables |

**StreamableHttpTransportConfig**:

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `'streamable-http'` | Yes | Transport type |
| `url` | `string` | Yes | MCP server endpoint URL |
| `headers` | `Record<string, string>` | No | HTTP headers (e.g. auth tokens) |

## 3. Connecting to a Local MCP Server (stdio)

This example connects to the official `@modelcontextprotocol/server-filesystem` which exposes file-system operations as MCP tools:

```bash
# First, make sure the MCP server package is available:
npx @modelcontextprotocol/server-filesystem --help
```

```ts
import {
  Agent, AnthropicAdapter, loadConfig,
  createMCPPlugin, PermissionManager, AllowAllResolver,
} from 'mochikit';

const cfg = loadConfig();

// Create the MCP plugin for a local filesystem server
const mcp = createMCPPlugin({
  servers: [
    {
      name: 'filesystem',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      },
      permissionMode: 'auto-allow',
    },
  ],
});

const agent = new Agent({
  name: 'fs-agent',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You can read and write files using MCP tools.',
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

// Install the plugin and wait for connections
agent.use(mcp.plugin);
await mcp.init();

// Now the agent can use filesystem tools
console.log(await agent.run('List all files in /tmp'));
```

The agent now has access to tools like:
- `mcp__filesystem__read_file`
- `mcp__filesystem__write_file`
- `mcp__filesystem__list_directory`
- `mcp__filesystem__search_files`

## 4. Connecting to a Remote MCP Server (Streamable HTTP)

For remote servers, use the `streamable-http` transport:

```ts
const mcp = createMCPPlugin({
  servers: [
    {
      name: 'internal-api',
      transport: {
        type: 'streamable-http',
        url: 'https://api.internal.example.com/mcp',
        headers: {
          Authorization: 'Bearer your-api-token',
        },
      },
      permissionMode: 'manual', // require user approval for each call
    },
  ],
});
```

## 5. Using MCP Tools in an Agent (Complete Example)

```ts
import {
  Agent, AnthropicAdapter, loadConfig,
  createMCPPlugin, PermissionManager, AllowAllResolver,
} from 'mochikit';

async function main() {
  const cfg = loadConfig();

  // 1. Configure MCP servers
  const mcp = createMCPPlugin({
    servers: [
      {
        name: 'filesystem',
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        },
        permissionMode: 'auto-allow',
      },
    ],
  });

  // 2. Create the agent
  const agent = new Agent({
    name: 'mcp-demo',
    llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
    model: cfg.model,
    systemPrompt:
      'You are a helpful assistant. You have access to filesystem tools via MCP. ' +
      'Use them to read, write, and list files. Tools are named with an mcp__filesystem__ prefix.',
    permission: new PermissionManager({ resolver: new AllowAllResolver() }),
  });

  // 3. Install MCP tools
  agent.use(mcp.plugin);

  // 4. Wait for connections
  const results = await mcp.init();
  for (const r of results) {
    if (r.success) {
      console.log(`✅ ${r.serverName}: ${r.toolCount} tools discovered`);
    } else {
      console.warn(`❌ ${r.serverName}: ${r.error}`);
    }
  }

  // 5. Run the agent
  const answer = await agent.run(
    'Read the file package.json and tell me what dependencies this project has.',
  );
  console.log(answer);

  // 6. Clean up
  await mcp.disconnectAll();
}

main().catch(console.error);
```

## 6. Dynamic Connection Management

The `MCPSessionHandle` returned by `createMCPPlugin` provides lifecycle methods:

```ts
const mcp = createMCPPlugin({ servers: [...] });

// Wait for all connections to settle
const results = await mcp.init();
// results: MCPServerConnectionResult[]

// Reconnect a specific server after a restart
await mcp.reconnect('filesystem');

// Disconnect all servers
await mcp.disconnectAll();
```

### MCPServerConnectionResult

```ts
interface MCPServerConnectionResult {
  serverName: string;  // Normalized server name
  success: boolean;     // Whether the connection succeeded
  toolCount: number;    // Number of tools discovered (0 if failed)
  error?: string;       // Error message if failed
}
```

## 7. Tool Naming Convention

MCP tools are registered with a **namespace prefix** to prevent collisions:

```
mcp__<server_name>__<tool_name>
```

The `__` (double underscore) separator is safe because MochiKit's `normalizeName()` function strips everything outside `[A-Za-z0-9_-]` before registration.

Examples:

| Server Config Name | MCP Tool Name | Registered As |
|---|---|---|
| `filesystem` | `read_file` | `mcp__filesystem__read_file` |
| `github` | `create_issue` | `mcp__github__create_issue` |
| `my server!` | `search docs` | `mcp__my_server___search_docs` |

## 8. Security Considerations

### 8.1 Permission Modes

| Mode | Behavior | When to Use |
|---|---|---|
| `auto-allow` | All tools from this server are allowed automatically | Trusted local servers |
| `manual` | Each tool call goes through the agent's permission pipeline | Untrusted remote servers |

In `auto-allow` mode, the plugin registers a `PermissionRule` that uses prefix matching: any tool whose name starts with `mcp__<server>__` is allowed. In `manual` mode, no such rule is registered, and the agent's existing permission rules and resolver decide.

### 8.2 Tool Error Handling

If an MCP server disconnects or a tool call fails, the error is caught and returned as a string to the model (not thrown). The model can then adapt — for example, by telling the user the tool is temporarily unavailable.

### 8.3 Best Practices

1. **Use `auto-allow` for local servers only.** For remote servers, use `manual` mode and configure your `PermissionManager` appropriately.
2. **Wait for `init()` before the first `run()`.** This ensures MCP tools are registered before the agent tries to use them (if you don't wait, the first `run()` might not have the tools available yet).
3. **Handle connection failures gracefully.** Check `init()` results and log warnings for failed servers.
4. **Clean up with `disconnectAll()`.** When shutting down, disconnect from MCP servers to avoid leaking subprocesses or connections.

## 9. Limitations (v1)

The current MCP integration focuses on **tool discovery and invocation**. The following MCP features are not yet implemented:

- **Resources** — `resources/list` and `resources/read` are not yet exposed
- **Prompts** — `prompts/list` and `prompts/get` are not yet exposed
- **OAuth authentication** — For servers requiring OAuth 2.0 / PKCE
- **WebSocket transport** — Only stdio and Streamable HTTP are supported
- **Channel notifications** — Server-to-agent push notifications

These features can be added in future releases without breaking the existing API — the architecture supports them through the same `MCPClientWrapper` pattern.

## 10. Troubleshooting

### "Failed to load @modelcontextprotocol/sdk"

Make sure the SDK is installed:

```bash
npm install @modelcontextprotocol/sdk
```

### "Connection closed" for stdio servers

Check that:
- The command is on your system PATH
- The MCP server package is installed (`npx` installs it on first run)
- The server process is not crashing on startup

### Tools not showing up in the agent

- Check `init()` results — a failed connection means no tools registered
- Verify the server is reachable (for HTTP) or the command works (for stdio)
- The connection is async — if you call `agent.run()` before `init()` settles, tools may not be registered yet

Next chapter: [17-Config & Env Vars](17-config-and-env-vars.md).
