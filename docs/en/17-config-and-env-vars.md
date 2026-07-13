# 15 - Configuration & Environment Variables

In this chapter you will learn how to configure MochiKit via environment variables, set up multiple providers, and deploy flexibly across test and production environments.

## 1. All Environment Variables

Configure in `.env` (or set directly in the system environment):

### Default Provider (No Prefix)

| Variable | Purpose | Default |
|---|---|---|
| `BASE_URL` | Default LLM endpoint | `https://open.bigmodel.cn/api/anthropic` |
| `API_KEY` | Default LLM key | (required) |
| `MODEL` | Default model name | `glm-4.7` |
| `MOCHIKIT_WEB_API_KEY` | Web tool key (default) | Same as `API_KEY` |
| `MOCHIKIT_RUN_INTEGRATION` | Whether to run real-LLM integration tests | `0` |

### Named Providers (Prefix Convention)

Format: `{NAME}_API_KEY`, `{NAME}_BASE_URL`, `{NAME}_MODEL`, `{NAME}_WEB_API_KEY`

| Variable Pattern | Purpose | Default |
|---|---|---|
| `{NAME}_API_KEY` | Provider LLM key | — |
| `{NAME}_BASE_URL` | Provider LLM endpoint | `''` (empty) |
| `{NAME}_MODEL` | Provider default model | `''` (empty) |
| `{NAME}_WEB_API_KEY` | Provider web tool key | Same as `{NAME}_API_KEY` |

**Prefix rules**:
- The prefix must be all **uppercase**, at least 2 characters, containing only uppercase letters and digits (regex: `/^[A-Z][A-Z0-9]+_API_KEY$/`).
- The framework automatically scans `process.env` at startup and discovers all matching prefixes.
- If `{NAME}_API_KEY` is empty, that provider is skipped.

Example `.env`:

```dotenv
# Default provider (GLM)
BASE_URL=https://open.bigmodel.cn/api/anthropic
API_KEY=your-glm-key
MODEL=glm-4.7

# DeepSeek
DEEPSEEK_API_KEY=sk-your-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# OpenAI
OPENAI_API_KEY=sk-your-openai-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

`.env.example` is a template — copy it to `.env` and fill in the values.

## 2. loadConfig()

```ts
import { loadConfig } from 'mochikit';

// Default provider
const cfg = loadConfig();

// Specify a provider
const deepCfg = loadConfig('deepseek');
const openaiCfg = loadConfig('openai');
```

### Return Value: `MochiConfig`

```ts
interface MochiConfig {
  // Flat fields — reflect the currently selected provider (backward compatible)
  baseUrl: string;
  apiKey: string;
  model: string;
  webApiKey: string;
  runIntegration: boolean;

  // Multi-provider fields (added in v0.2.0)
  defaultProvider: string;                    // current provider name
  providers: Record<string, ProviderConfig>;  // all discovered providers
}

interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  webApiKey: string;
}
```

`providers` always includes a `'default'` key (corresponding to the unprefixed default provider).

### Call Forms

| Call | Provider | .env Path |
|---|---|---|
| `loadConfig()` | `'default'` | Auto-discovered |
| `loadConfig('deepseek')` | `'deepseek'` | Auto-discovered |
| `loadConfig('/path/to/.env')` | `'default'` | Explicit path |
| `loadConfig('deepseek', '/path/to/.env')` | `'deepseek'` | Explicit path |

### Automatic Provider Name vs. Path Disambiguation

The first argument to `loadConfig` can be either a provider name or a `.env` file path. The framework distinguishes them via these rules:
- Contains `/` or `\` (path separator) → treated as a path
- Ends with `.env` → treated as a path
- Otherwise → treated as a provider name (case-insensitive)

### Unknown Provider

If you specify a provider name that is not configured, the framework throws a clear error:

```
Unknown provider "unknown". Available providers: default, deepseek.
Set UNKNOWN_API_KEY, UNKNOWN_BASE_URL, UNKNOWN_MODEL in your .env file.
```

### Caching Behavior

- The first call to `loadConfig()` loads `.env` and scans all providers; the result is cached.
- Subsequent calls (regardless of which provider name is passed) build the return value directly from the cache — zero overhead.
- `resetConfigCache()` clears the cache (for testing).

## 3. Specifying a .env Path

```ts
// Use a custom .env file + default provider
loadConfig('/path/to/my.env');

// Specify provider + custom .env file
loadConfig('openai', '/path/to/production.env');
```

## 4. Skipping dotenv — Manual Construction

You can also bypass environment variables entirely and pass parameters directly:

```ts
import { AnthropicAdapter } from 'mochikit';

const llm = new AnthropicAdapter({
  apiKey: process.env.MY_KEY!,
  baseURL: 'https://open.bigmodel.cn/api/anthropic',
});
```

## 5. Integration Test Toggle

Integration tests skip by default to avoid failures when no credentials are present. Enable them:

```bash
MOCHIKIT_RUN_INTEGRATION=1 npx vitest run tests/integration
```

Or use `npm run test:integration` (which already sets this env var).

## 6. Multi-Environment Recommendations

- **Local dev**: Fill `.env` with test keys, set `MOCHIKIT_RUN_INTEGRATION=1`.
- **CI/Production**: Inject `API_KEY` etc. via CI secrets; `.env` is not committed (already in `.gitignore`).
- **Different models**: Each Agent can set its own `model` / `fallbackModel` — no need for global uniformity.
- **Multiple providers**:
  - Option A: Put all provider keys in a single `.env`, switch via `loadConfig('provider')`.
  - Option B: Separate `.env` file per provider, load via `loadConfig('provider', '/path/.env')`.
  - Option C: CI injects environment variables (no `.env` file needed); `loadConfig()` auto-discovers from `process.env`.

## 7. Typical Scenarios

### 7.1 Manager Uses a Cheap Model, Worker Uses a Strong Model

```ts
const cheapCfg = loadConfig('deepseek');   // DeepSeek is cheap
const strongCfg = loadConfig('openai');    // OpenAI is powerful

const manager = new Agent({
  name: 'manager',
  llm: new AnthropicAdapter({ apiKey: cheapCfg.apiKey, baseURL: cheapCfg.baseUrl }),
  model: 'deepseek-chat',
  systemPrompt: 'You are responsible for task decomposition.',
});

const worker = new Agent({
  name: 'worker',
  llm: new AnthropicAdapter({ apiKey: strongCfg.apiKey, baseURL: strongCfg.baseUrl }),
  model: 'gpt-4o',
  systemPrompt: 'You are responsible for complex reasoning.',
});
```

### 7.2 Listing All Available Providers

```ts
const cfg = loadConfig();
for (const [name, p] of Object.entries(cfg.providers)) {
  console.log(`${name}: ${p.model} @ ${p.baseUrl}`);
}
// default: glm-4.7 @ https://open.bigmodel.cn/api/anthropic
// deepseek: deepseek-chat @ https://api.deepseek.com/v1
// openai: gpt-4o @ https://api.openai.com/v1
```

Next chapter: [18-Testing Guide](18-testing-guide.md).
