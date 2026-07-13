# 02 - First Agent

In this chapter you'll learn: how to create an Agent, give it a role, run it, and get a response.

## 1. What Is an Agent

In MochiKit, an `Agent` is "an AI assistant instance that can think and use tools." You provide it with:

- An LLM client (which model to use)
- A system prompt (what role it plays)
- A set of tools (optional -- what actions it can take)

Then call `agent.run("your question")` and it will think and return an answer.

## 2. Minimal Example

```ts
import { Agent, AnthropicAdapter, loadConfig } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'my-agent',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You are a friendly technical assistant. Answer concisely.',
});

const reply = await agent.run('What is dependency injection?');
console.log(reply);
```

Expected output: a concise explanation of dependency injection.

## 3. All Agent Options

```ts
const agent = new Agent({
  name: 'my-agent',            // Required: name (also used for logging/permissions/multi-agent)
  llm: ...,                    // Required: LLM client
  model: 'glm-4.7',            // Required: model name
  systemPrompt: '...',         // Required: system prompt

  tools: [],                   // Optional: array of tools
  memory: ...,                 // Optional: memory instance
  bus: ...,                    // Optional: message bus (for multi-agent)
  tasks: ...,                  // Optional: task store
  hooks: ...,                  // Optional: hook manager
  permission: ...,             // Optional: permission manager

  maxTurns: 30,                // Optional: max thinking turns (safety limit), default 30
  maxTokens: 8192,             // Optional: max tokens per response, default 8192
  fallbackModel: undefined,    // Optional: fallback model under overload
  cwd: process.cwd(),          // Optional: working directory for tool execution
});
```

## Dynamic System Prompt

If you need to assemble the system prompt dynamically based on runtime state, use `systemSections`:

```ts
import { type PromptSection } from 'mochikit';

const sections: PromptSection[] = [
  { key: 'identity', content: 'You are a helpful coding agent. Be concise.' },
  { key: 'workspace', content: `Working directory: ${process.cwd()}` },
  {
    key: 'memory',
    content: 'Relevant memories are below.',
    condition: (ctx) => ctx.hasMemory, // Only loaded when Memory is present
  },
];

const agent = new Agent({
  // ...
  systemPrompt: 'fallback', // Static fallback
  systemSections: sections,
});
```

Conditional sections (`condition`) are only included in the prompt when their condition is met, saving tokens.

## 4. Multi-Turn Conversations

`agent.run()` preserves conversation history inside the Agent. Call it repeatedly for multi-turn dialogue:

```ts
await agent.run('My name is Alex.');
const reply = await agent.run('What is my name?');
console.log(reply); // Should answer "Alex"
```

To clear history and start fresh:

```ts
agent.reset();
```

## 5. What Is maxTurns

Internally, the Agent runs a loop: model thinks -> calls a tool -> feeds results back to the model -> thinks again... until the model stops requesting tools. `maxTurns` is the safety cap on this loop, preventing infinite loops. A plain Q&A finishes in 1 turn; tasks with tools typically take 3-8 turns.

## 6. Adding Tools to an Agent

The next chapter covers this in detail. Here's a quick preview:

```ts
import { createBashTool, createFsTools, AllowAllResolver, PermissionManager } from 'mochikit';

const agent = new Agent({
  name: 'coder',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You are a coding assistant. You can use bash and file tools.',
  tools: [createBashTool(), ...createFsTools()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

console.log(await agent.run('List the files in the current directory'));
```

> Tools that execute code or write files should generally be paired with a `PermissionManager` (see Chapter 11) to control permissions.

## 7. Common Issues

- **`Invalid URL` error**: Check that `.env`'s `BASE_URL` is loading correctly (see Chapter 15).
- **Agent never finishes**: Reduce `maxTurns`, or check whether tools are returning valid results.
- **Response gets truncated**: Increase `maxTokens`.

Next chapter: [03-Tool System](03-tool-system.md).
