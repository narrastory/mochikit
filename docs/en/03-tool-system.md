# 03 - Tool System

In this chapter you'll learn: how to use built-in tools, write your own tool, and register tools with an Agent.

Tools are what give an Agent the ability to "do things": read files, run commands, query databases, call APIs... The model decides which tool to call and with what parameters; the framework handles execution and feeds results back to the model.

## 1. Built-in Tools at a Glance

MochiKit ships with these out of the box:

| Factory Function | Tool(s) | Description |
|---|---|---|
| `createBashTool()` | `bash` | Execute shell commands |
| `createFsTools()` | `read_file` / `write_file` / `edit_file` / `glob` / `grep` | File I/O and search |
| `createWebSearchTool(key)` | `web_search` | GLM web search (see Chapter 14) |
| `createWebReaderTool(key)` | `web_reader` | GLM web reader (see Chapter 14) |
| `createMemoryTools(memory)` | `memory_read` / `memory_write` | Read/write memory (see Chapter 4) |
| `createTaskTools(tasks)` | `create_task` / `claim_task` / `complete_task` | Task management (see Chapter 9) |
| `createTeamTools(bus, name)` | `send_message` / `check_inbox` | Team communication (see Chapter 8) |

## 2. Equipping an Agent with Built-in Tools

```ts
import { Agent, AnthropicAdapter, loadConfig, createBashTool, createFsTools, AllowAllResolver, PermissionManager } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'dev',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You are a dev assistant. Use tools effectively.',
  tools: [createBashTool(), ...createFsTools()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

console.log(await agent.run('Read package.json and tell me the project name'));
```

Tools are automatically exposed to the model as JSON Schema -- no manual declaration needed.

## 3. Custom Tools (Recommended: Extend BaseTool)

```ts
import { BaseTool, type ToolContext } from 'mochikit';

class WeatherTool extends BaseTool {
  // 1. Declare the tool definition (name, description, parameter schema)
  readonly definition = {
    name: 'get_weather',
    description: 'Query the weather for a city.',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' },
      },
      required: ['city'],
    },
  };

  // 2. Implement the execution logic
  async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const city = this.requireString(input, 'city'); // Type-safe parameter extraction
    // In production, call a real weather API here
    return `${city}: Sunny, 25°C`;
  }
}

const agent = new Agent({
  // ...
  tools: [new WeatherTool()],
});
```

`BaseTool` provides parameter extraction helpers:

- `this.requireString(input, 'city')` -- required string, throws if missing
- `this.optionalString(input, 'note')` -- optional string
- `this.optionalNumber(input, 'count')` -- optional number

## 4. Quick Wrapper: toolFromFunction

If your tool logic is simple and you don't want to create a class, use `toolFromFunction`:

```ts
import { toolFromFunction } from 'mochikit';

const echo = toolFromFunction(
  {
    name: 'echo',
    description: 'Return the input text unchanged.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  async (input) => `echo: ${input.text}`,
);

const agent = new Agent({ /* ... */ tools: [echo] });
```

## 5. ToolContext

Every tool receives a context object during execution:

```ts
interface ToolContext {
  agentName: string;      // Current Agent name
  cwd: string;            // Working directory
  memory?: Memory;        // Agent's memory (if configured)
  bus?: MessageBus;       // Message bus (if configured)
  tasks?: TaskStore;      // Task store (if configured)
  runtime?: Record<string, unknown>; // Runtime extra data
}
```

Tools can read `ctx.memory` / `ctx.tasks` etc. to interact with the Agent's infrastructure.

## 6. Dynamic Tool Registration / Removal

You can add tools at runtime:

```ts
agent.registerTool(new WeatherTool());
```

## 7. Namespace Isolation (MCP-style)

When integrating external tool sets (e.g., from an MCP server), use namespaces to avoid name collisions:

```ts
import { ToolRegistry } from 'mochikit';
// The Agent already has an internal registry; here's standalone usage
const reg = new ToolRegistry();
reg.registerNamespaced('github', new WeatherTool());
// The actual tool name becomes github__get_weather
```

## 8. Concurrency Safety Marker

If a tool is safe to execute concurrently (e.g., read-only queries), override `isConcurrencySafe`:

```ts
class SafeQueryTool extends BaseTool {
  // ...
  isConcurrencySafe(): boolean {
    return true;
  }
}
```

The framework can then batch multiple safe tools for concurrent execution (sequential dispatch in the current version; concurrent support is reserved for future extension).

## TodoWrite Tool (In-Conversation Planning)

`todo_write` lets the model outline a plan first, then execute during long tasks. Unlike TaskStore (persistent DAG), this is lightweight planning within the current conversation.

```ts
import { createTodoWriteTool } from 'mochikit';

const agent = new Agent({
  // ...
  tools: [createTodoWriteTool()],
});
```

The model will automatically call `todo_write` at the start of complex tasks to list steps, then check them off as they're done. If no update occurs for 3 consecutive turns, the system will automatically remind.

The tool accepts `{todos: [{content: string, status: 'pending'|'in_progress'|'completed'}]}` -- each call fully replaces the list.

## Bash Background Execution

The `bash` tool now supports a `run_in_background: true` parameter. For long-running commands like `npm install` or `npm test`, the Agent won't block waiting:

```ts
import { createBashTool, BackgroundTaskManager } from 'mochikit';

const agent = new Agent({
  // ...
  tools: [createBashTool()],
  backgroundTasks: new BackgroundTaskManager(),
});
```

The model determines which commands are suitable for background execution (installs, builds, tests, etc.). The Agent immediately receives a placeholder result and continues working. When the background command completes, a notification is automatically injected.

Next chapter: [05-Memory System](05-memory-system.md).
