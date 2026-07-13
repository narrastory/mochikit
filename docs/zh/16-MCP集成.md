# 18 - MCP 集成

本章你将学习如何将 MochiKit Agent 连接到 MCP（Model Context Protocol，模型上下文协议）服务器——让 Agent 无需编写自定义工具代码即可使用外部服务的工具。

## 1. 什么是 MCP？

**MCP（Model Context Protocol）** 是一个开放标准，允许 AI Agent 发现并使用来自外部服务器的工具。MCP 服务器通过 JSON-RPC 接口暴露工具——Agent 发现可用的工具（`tools/list`）并在需要时调用它们（`tools/call`）。

MochiKit 支持两种传输方式：

| 传输方式 | 使用场景 | 示例 |
|---|---|---|
| **stdio** | 本地 MCP 服务器（子进程） | 文件系统工具、Git 工具、SQLite |
| **Streamable HTTP** | 远程 MCP 服务器 | GitHub API、Jira、内部服务 |

MCP 工具注册时使用**命名空间前缀**来防止冲突，格式为 `mcp__<服务器名>__<工具名>`——例如来自 `filesystem` 服务器的 `read_file` 工具会注册为 `mcp__filesystem__read_file`。这避免了服务器之间以及与内置工具的命名冲突。

## 2. 配置方式

### 2.1 编程式配置

直接将配置对象传入 `createMCPPlugin`：

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
      permissionMode: 'auto-allow', // 信任此服务器的工具
    },
    {
      name: 'github',
      transport: {
        type: 'streamable-http',
        url: 'http://localhost:3000/mcp',
        headers: { Authorization: 'Bearer sk-xxx' },
      },
      permissionMode: 'manual', // 通过权限检查
    },
  ],
});
```

### 2.2 环境变量配置

在 `.env` 中声明 MCP 服务器，然后使用 `loadMCPConfigFromEnv()`：

```env
# 通过 stdio 连接本地文件系统服务器
MCP__FILESYSTEM__TRANSPORT=stdio
MCP__FILESYSTEM__COMMAND=npx
MCP__FILESYSTEM__ARGS=-y @modelcontextprotocol/server-filesystem /tmp
MCP__FILESYSTEM__PERMISSION=auto-allow

# 通过 HTTP 连接远程 GitHub 服务器
MCP__GITHUB__TRANSPORT=streamable-http
MCP__GITHUB__URL=http://localhost:3000/mcp
MCP__GITHUB__HEADERS=Authorization: Bearer sk-xxx
MCP__GITHUB__PERMISSION=manual
```

```ts
const mcp = createMCPPlugin(loadMCPConfigFromEnv());
```

### 2.3 MCPServerConfig 参考

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | `string` | 是 | 唯一服务器名称，用作命名空间前缀 |
| `transport` | `MCPTransportConfig` | 是 | 连接方式（`stdio` 或 `streamable-http`） |
| `permissionMode` | `'auto-allow' \| 'manual'` | 否 | 默认 `'auto-allow'` |

**StdioTransportConfig**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | `'stdio'` | 是 | 传输类型 |
| `command` | `string` | 是 | 要启动的命令（如 `npx`、`python`） |
| `args` | `string[]` | 否 | 命令参数 |
| `env` | `Record<string, string>` | 否 | 额外的环境变量 |

**StreamableHttpTransportConfig**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | `'streamable-http'` | 是 | 传输类型 |
| `url` | `string` | 是 | MCP 服务器端点 URL |
| `headers` | `Record<string, string>` | 否 | HTTP 请求头（如认证令牌） |

## 3. 连接本地 MCP 服务器（stdio）

此示例连接到官方的 `@modelcontextprotocol/server-filesystem`，它暴露文件系统操作作为 MCP 工具：

```bash
# 首先确保 MCP 服务器包可用：
npx @modelcontextprotocol/server-filesystem --help
```

```ts
import {
  Agent, AnthropicAdapter, loadConfig,
  createMCPPlugin, PermissionManager, AllowAllResolver,
} from 'mochikit';

const cfg = loadConfig();

// 为本地文件系统服务器创建 MCP 插件
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
  systemPrompt: '你可以使用 MCP 工具来读写文件。',
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

// 安装插件并等待连接
agent.use(mcp.plugin);
await mcp.init();

// 现在 Agent 可以使用文件系统工具了
console.log(await agent.run('列出 /tmp 中的所有文件'));
```

Agent 现在可以访问以下工具：
- `mcp__filesystem__read_file`
- `mcp__filesystem__write_file`
- `mcp__filesystem__list_directory`
- `mcp__filesystem__search_files`

## 4. 连接远程 MCP 服务器（Streamable HTTP）

对于远程服务器，使用 `streamable-http` 传输方式：

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
      permissionMode: 'manual', // 每次调用都需要用户批准
    },
  ],
});
```

## 5. 在 Agent 中使用 MCP 工具（完整示例）

```ts
import {
  Agent, AnthropicAdapter, loadConfig,
  createMCPPlugin, PermissionManager, AllowAllResolver,
} from 'mochikit';

async function main() {
  const cfg = loadConfig();

  // 1. 配置 MCP 服务器
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

  // 2. 创建 Agent
  const agent = new Agent({
    name: 'mcp-demo',
    llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
    model: cfg.model,
    systemPrompt:
      '你是一个有用的助手。你可以通过 MCP 访问文件系统工具。' +
      '工具名称带有 mcp__filesystem__ 前缀。',
    permission: new PermissionManager({ resolver: new AllowAllResolver() }),
  });

  // 3. 安装 MCP 工具
  agent.use(mcp.plugin);

  // 4. 等待连接完成
  const results = await mcp.init();
  for (const r of results) {
    if (r.success) {
      console.log(`✅ ${r.serverName}: 发现 ${r.toolCount} 个工具`);
    } else {
      console.warn(`❌ ${r.serverName}: ${r.error}`);
    }
  }

  // 5. 运行 Agent
  const answer = await agent.run(
    '读取 package.json 文件，告诉我这个项目有哪些依赖。',
  );
  console.log(answer);

  // 6. 清理
  await mcp.disconnectAll();
}

main().catch(console.error);
```

## 6. 动态连接管理

`createMCPPlugin` 返回的 `MCPSessionHandle` 提供了生命周期方法：

```ts
const mcp = createMCPPlugin({ servers: [...] });

// 等待所有连接完成
const results = await mcp.init();
// results: MCPServerConnectionResult[]

// 服务器重启后重新连接
await mcp.reconnect('filesystem');

// 断开所有服务器连接
await mcp.disconnectAll();
```

### MCPServerConnectionResult

```ts
interface MCPServerConnectionResult {
  serverName: string;  // 规范化后的服务器名称
  success: boolean;     // 连接是否成功
  toolCount: number;    // 发现的工具数量（失败时为 0）
  error?: string;       // 失败时的错误信息
}
```

## 7. 工具命名约定

MCP 工具注册时带有**命名空间前缀**以防止冲突：

```
mcp__<服务器名称>__<工具名称>
```

`__`（双下划线）分隔符是安全的，因为 MochiKit 的 `normalizeName()` 函数会在注册前去除所有 `[A-Za-z0-9_-]` 以外的字符。

示例：

| 服务器配置名称 | MCP 工具名称 | 注册后名称 |
|---|---|---|
| `filesystem` | `read_file` | `mcp__filesystem__read_file` |
| `github` | `create_issue` | `mcp__github__create_issue` |
| `my server!` | `search docs` | `mcp__my_server___search_docs` |

## 8. 安全注意事项

### 8.1 权限模式

| 模式 | 行为 | 使用场景 |
|---|---|---|
| `auto-allow` | 自动允许此服务器的所有工具 | 受信任的本地服务器 |
| `manual` | 每次工具调用都经过 Agent 权限管线 | 不受信任的远程服务器 |

在 `auto-allow` 模式下，插件注册一个使用前缀匹配的 `PermissionRule`：任何以 `mcp__<服务器名>__` 开头的工具名称都会被允许。在 `manual` 模式下，不会注册此类规则，由 Agent 现有的权限规则和解析器来决定。

### 8.2 工具错误处理

如果 MCP 服务器断开连接或工具调用失败，错误会被捕获并作为字符串返回给模型（不会抛出异常）。模型可以据此调整——例如，告诉用户该工具暂时不可用。

### 8.3 最佳实践

1. **仅对本地服务器使用 `auto-allow`。** 对于远程服务器，使用 `manual` 模式并适当配置 `PermissionManager`。
2. **在首次 `run()` 之前等待 `init()`。** 这确保 MCP 工具在 Agent 尝试使用它们之前已注册完成。
3. **优雅处理连接失败。** 检查 `init()` 结果并为失败的服务器记录警告。
4. **使用 `disconnectAll()` 清理。** 关闭时断开 MCP 服务器连接，避免泄漏子进程或连接。

## 9. 当前限制（v1）

当前 MCP 集成专注于**工具发现和调用**。以下 MCP 功能尚未实现：

- **Resources** — `resources/list` 和 `resources/read` 暂未暴露
- **Prompts** — `prompts/list` 和 `prompts/get` 暂未暴露
- **OAuth 认证** — 需要 OAuth 2.0 / PKCE 的服务器暂不支持
- **WebSocket 传输** — 仅支持 stdio 和 Streamable HTTP
- **Channel 通知** — 服务器到 Agent 的推送通知暂不支持

这些功能可以在未来版本中添加，而不会破坏现有 API——架构通过相同的 `MCPClientWrapper` 模式支持它们。

## 10. 故障排除

### "Failed to load @modelcontextprotocol/sdk"

确保已安装 SDK：

```bash
npm install @modelcontextprotocol/sdk
```

### stdio 服务器 "Connection closed"

检查：
- 命令是否在系统 PATH 中
- MCP 服务器包是否已安装（`npx` 会在首次运行时安装）
- 服务器进程是否在启动时崩溃

### 工具未出现在 Agent 中

- 检查 `init()` 结果——连接失败意味着没有工具被注册
- 验证服务器是否可达（HTTP 方式）或命令是否正常工作（stdio 方式）
- 连接是异步的——如果在 `init()` 完成之前调用 `agent.run()`，工具可能尚未注册

下一章：[17-配置与环境变量](17-配置与环境变量.md)。
