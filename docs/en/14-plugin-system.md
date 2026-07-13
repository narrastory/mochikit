# 13 - Plugin System

In this chapter you will learn how to bundle tools + hooks + permission rules into a single plugin — write once, reuse everywhere.

## 1. What Is a Plugin

When you build a set of related capabilities (e.g. a "timezone plugin": one time tool + one audit hook + one permission rule), you can package them as a `Plugin` and install them with a single line: `agent.use(plugin)`.

## 2. Building with PluginBuilder

```ts
import { PluginBuilder, BaseTool, type ToolContext } from 'mochikit';

// A tool
class CurrentTimeTool extends BaseTool {
  readonly definition = {
    name: 'current_time',
    description: 'Get the current ISO time.',
    input_schema: { type: 'object', properties: {} },
  };
  async execute(): Promise<string> {
    return new Date().toISOString();
  }
}

// Package into a plugin
const timePlugin = new PluginBuilder('time-plugin')
  .tool(new CurrentTimeTool())                     // add tool
  .hook('PostToolUse', (p) => {                    // add hook
    const payload = p as { tool: { name: string } };
    console.log('[audit]', payload.tool.name);
  })
  .rule({                                          // add permission rule
    name: 'allow-time',
    tools: ['current_time'],
    check: () => 'allow' as const,
  })
  .build();
```

## 3. Installing on an Agent

```ts
import { Agent, AnthropicAdapter, loadConfig, AllowAllResolver, PermissionManager } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'plugin-demo',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You can use the current_time tool to check the time.',
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

agent.use(timePlugin); // install in one line

console.log(await agent.run('What time is it now? Use the tool to check.'));
```

`Agent` implements the `PluginHost` interface, so `use(plugin)` registers all of the plugin's tools, hooks, and rules.

## 4. Writing the Plugin Interface by Hand

You can also implement the interface directly instead of using the Builder:

```ts
import type { Plugin, PluginHost } from 'mochikit';

const myPlugin: Plugin = {
  name: 'my-plugin',
  install(host: PluginHost) {
    host.registerTool(new CurrentTimeTool());
    host.registerHook('PostToolUse', (p) => { /* ... */ });
    host.registerPermissionRule({ /* ... */ });
  },
};

agent.use(myPlugin);
```

## 5. Sharing Plugins Across Agents

Use `PluginRegistry` to collect a set of registrations, then apply them in bulk to multiple Agents:

```ts
import { PluginRegistry } from 'mochikit';

const registry = new PluginRegistry();
registry.install(timePlugin);
registry.install(anotherPlugin);

// Apply to agentA and agentB
registry.applyTo(agentA);
registry.applyTo(agentB);
```

## 6. What PluginHost Provides

`PluginHost` (implemented by `Agent`) exposes three methods:

- `registerTool(tool)` — register a tool
- `registerHook(event, cb, priority?)` — register a hook
- `registerPermissionRule(rule)` — register a permission rule

When a plugin's `install(host)` is called, it receives the host and calls these methods to complete registration.

Next chapter: [15-Web Tools](15-web-tools.md).
