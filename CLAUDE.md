# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run typecheck          # Strict TS typecheck (tsc --noEmit, 0 errors required)
npm run build              # Compile src/ → dist/ (ESM, NodeNext)
npm test                   # Run all tests (unit + integration)
npm run test:unit          # Unit tests only (vitest run tests/unit) — mock LLM, no network
npm run test:integration   # Integration tests (MOCHIKIT_RUN_INTEGRATION=1 vitest run tests/integration) — real GLM
npx vitest run tests/unit/<file>.test.ts   # Run a single unit-test file
npx tsx examples/01-simple-agent.ts        # Run one example directly
```

- A `.env` file (copied from `.env.example`) with `API_KEY` is required for integration tests and examples that hit GLM.
- Integration tests are gated on `MOCHIKIT_RUN_INTEGRATION=1`; they skip otherwise.
- `npm run test:integration` already prefixes the env var.

## Architecture

MochiKit is an **ESM-only** (`"type": "module"`) TypeScript AI Agent framework targeting Node 18+. All source lives in `src/` and is compiled to `dist/`. Strict TS with `noUnusedLocals`, `noUnusedParameters`, `noImplicitAny` — **no `any`** anywhere.

### Core loop (the central insight)

Every agent runs the same loop: `LLM → tool_use → results → repeat`. All mechanisms (hooks, permissions, compaction, recovery, collaboration) hang off this loop. The complexity is in the harness, not the model.

```
src/core/agent-loop.ts   — The inference loop: compact → call LLM → dispatch tools → repeat
src/core/agent.ts        — User-facing class; composes all DI components, implements PluginHost
src/core/types.ts        — ContentBlock (TextBlock | ToolUseBlock | ToolResultBlock), Message, LLMResponse
src/core/llm-client.ts   — LLMClient interface + AnthropicAdapter (wraps @anthropic-ai/sdk, points at GLM endpoint)
```

### Key components (all constructor-injected — no global singletons except read-only config)

| Module | Role |
|---|---|
| `ToolRegistry` (`src/core/tool-registry.ts`) | Dispatch map; namespaced registration (`mcp__server__tool`) for collision-free plugin tools |
| `Tool` / `BaseTool` (`src/core/tool.ts`) | Tool contract; BaseTool provides `requireString`/`optionalString`/`optionalNumber` helpers. `ToolContext` carries agentName, cwd, memory, bus, tasks, runtime |
| `HookManager` (`src/core/hooks.ts`) | Priority-ordered lifecycle hooks: `UserPromptSubmit` (can rewrite input), `PreToolUse` (can block), `PostToolUse`, `Stop`. Short-circuits on first block |
| `PermissionManager` (`src/core/permission.ts`) | 3-gate pipeline: deny → rule → ask (delegates to `PermissionResolver`). `AllowAllResolver` / `DenyAllResolver` built in |
| `CompactionPipeline` (`src/core/compaction.ts`) | Layered context shrinking (budget → micro → snip, all 0 API calls). `reactiveCompact()` for emergency use |
| `Recovery` (`src/core/recovery.ts`) | 429/529 exponential backoff + jitter; `prompt_too_long` triggers one-time reactive compact; sustained overload switches to `fallbackModel` |

### Collaboration patterns

| Pattern | File | Mechanism |
|---|---|---|
| Manager-Worker | `src/collaboration/manager-worker.ts` | Manager gets a `spawn_teammate` tool; workers run in isolated contexts, only summaries returned |
| SequentialChain | `src/collaboration/chain.ts` | Each agent's output feeds the next as input; optional shared Memory |
| Team | `src/collaboration/team.ts` | Members share a MessageBus; each gets `send_message`/`check_inbox` tools |

### Memory & infra

| Component | File | Notes |
|---|---|---|
| `Memory` interface | `src/memory/memory.ts` | add/get/list/query/update/remove |
| `MarkdownMemory` | `src/memory/markdown-memory.ts` | Files: `<dir>/<slug>.md` with YAML frontmatter + `MEMORY.md` index. `query` uses keyword matching or optional LLM recall |
| `VectorStore` interface | `src/memory/vector-store.ts` | add/query/remove; documented Chroma/Pinecone extension contract |
| `InMemoryVectorStore` | `src/memory/in-memory-vector-store.ts` | Cosine similarity, metadata filtering |
| `MessageBus` | `src/infra/message-bus.ts` | InMemory (Map FIFO) + FileMessageBus (JSONL, async-locked); read = consume |
| `TaskStore` | `src/infra/task-store.ts` | DAG tasks with `blockedBy`; `canStart`/`claim`/`complete`; InMemory |
| `loadConfig()` | `src/infra/config.ts` | dotenv with `override:true`; walks up to find `.env`; cached; `resetConfigCache()` for tests |

### Plugins

`PluginBuilder` (`src/plugins/plugin.ts`) — fluent builder: `.tool()`, `.hook()`, `.rule()`, `.build()`.  
`Agent.use(plugin)` / `PluginRegistry.applyTo(agent)` for bulk registration.  
A plugin bundles tools + hooks + permission rules that install onto any `PluginHost`.

### Existing bug that must not regress

**AgentLoop spread overwriting defaults** (`src/core/agent-loop.ts:55`): `{...opts}` spreads `undefined` optional fields over defaults, causing `while (turns < undefined)` → never loops. Fixed by explicit `opts.maxTurns ?? 30` placed AFTER the spread. When adding optional fields to `AgentLoopOptions`, always follow this pattern — never rely on spread to provide defaults.

## Testing

- **Unit tests** (`tests/unit/`) use `MockLLMClient` (`tests/helpers/mock-llm.ts`) — a scripted queue: `textResponse()`, `toolUseResponse()`, `toolUseThenText()`. It deep-clones params (`JSON.parse(JSON.stringify(...))`) so later context mutations don't corrupt call history.
- **Integration tests** (`tests/integration/`) use real GLM via `tests/integration/helpers.ts`; gated by `describe.skipIf(!runIntegration)`. Assertions are intentionally loose (structural/non-empty/keyword) to tolerate LLM output variance.
- A `PermissionManager` without an explicit resolver defaults to `DenyAllResolver` — tools will be denied.
