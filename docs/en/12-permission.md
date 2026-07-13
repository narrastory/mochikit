# 11 - Permission System

In this chapter you will learn: how to control whether an agent can execute a tool call, preventing dangerous operations.

## 1. Why Permissions Are Needed

Agents can call tools like `bash` or `write_file`, and the model may generate dangerous commands (`rm -rf /`) or write
to the wrong path. `PermissionManager` performs a check **before every tool execution**, deciding whether to allow,
deny, or ask.

## 2. The Three-Gate Pipeline

Each tool call passes through three gates in order:

1. **deny**: matches a hard-deny rule → blocked immediately.
2. **rule**: matches a rule that produces a reason → handed to `PermissionResolver` to decide.
3. **ask**: the Resolver decides allow / deny.
4. If none matched → allowed by default.

## 3. Quick Start

```ts
import { Agent, AnthropicAdapter, loadConfig, createBashTool, PermissionManager, AllowAllResolver } from 'mochikit';

const cfg = loadConfig();

const permission = new PermissionManager({
  resolver: new AllowAllResolver(), // default allow when escalated to ask (suitable for sandbox/testing)
});

const agent = new Agent({
  name: 'safe',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: '你是助手。',
  tools: [createBashTool()],
  permission,
});
```

When `permission` is not provided, the Agent uses a default `PermissionManager` (whose default Resolver is
`DenyAllResolver`, meaning all "ask" escalations are denied).

## 4. Writing Permission Rules

```ts
import { PermissionManager, AllowAllResolver } from 'mochikit';

const permission = new PermissionManager({
  resolver: new AllowAllResolver(),
  rules: [
    {
      name: 'no-rm-rf',
      tools: ['bash'], // only applies to the bash tool; omit 'tools' to apply to all tools
      check: (ctx) => {
        const cmd = String(ctx.tool.input.command);
        return /rm\s+-rf/.test(cmd) ? 'deny' : 'passthrough';
        // 'deny'   → block directly
        // 'ask'    → hand to Resolver
        // 'passthrough' → let the next rule decide
        // return a string → treated as a reason, handed to Resolver
      },
      reason: 'rm -rf is a dangerous operation',
    },
    {
      name: 'workspace-write-only',
      tools: ['write_file', 'edit_file'],
      check: (ctx) => {
        const p = String(ctx.tool.input.path);
        return p.startsWith(process.cwd()) ? 'passthrough' : 'deny';
      },
      reason: 'writing outside the workspace is forbidden',
    },
  ],
});
```

Return values from the rule check function `check(ctx)`:

| Return | Meaning |
|---|---|
| `'allow'` | Allow |
| `'deny'` | Deny |
| `'ask'` | Hand to Resolver (using the `reason` field) |
| `'passthrough'` or `null` | Defer to the next rule |
| Any string | Treated as a reason, handed to Resolver |

## 5. PermissionResolver

The Resolver decides the final outcome for "ask"-category requests:

```ts
import { AllowAllResolver, DenyAllResolver, type PermissionResolver } from 'mochikit';

new AllowAllResolver(); // allow everything
new DenyAllResolver();  // deny everything

// Custom: interactive prompt (CLI scenario)
const interactive: PermissionResolver = {
  async resolve(ctx, reason) {
    const answer = await askUser(`${reason}\nAllow execution of ${ctx.tool.name}? (y/n)`);
    return answer === 'y' ? 'allow' : 'deny';
  },
};
```

## 6. Runtime Adjustments

```ts
permission.addRule({ /* ... */ });   // add a rule
permission.setResolver(new DenyAllResolver()); // swap the Resolver
agent.registerPermissionRule({ /* ... */ });   // add a rule via Agent
```

## 7. Differences from Hooks

- `PermissionManager`: declarative, focused on "allow/deny tools."
- `PreToolUse` Hook: more flexible — can rewrite results, terminate the loop, perform side effects.

Permissions suit "security policy," while Hooks suit "general-purpose extension." The two can be layered (Hook runs
first, Permission runs after).

Next chapter: [13-Compaction & Recovery](13-compaction-and-recovery.md).
