# 01 - Installation & Configuration

In this chapter you'll learn: how to install MochiKit in a project, configure LLM credentials, and run your first script.

## 1. Requirements

- Node.js >= 18 (20+ recommended)
- An LLM API key. This guide uses GLM (Zhipu) as an example (Anthropic-protocol compatible).

## 2. Installation

If your project is already initialized, install directly:

```bash
npm install mochikit
```

If you're working with the repository source (for development/learning), run from the repo root:

```bash
npm install
```

This installs the runtime dependencies `@anthropic-ai/sdk`, `dotenv`, and dev dependencies `typescript`, `tsx`, `vitest`.

## 3. Configure Credentials (.env)

Create a `.env` file in your project root (do not commit it to git):

```dotenv
# LLM endpoint (GLM Zhipu Anthropic-compatible endpoint)
BASE_URL=https://open.bigmodel.cn/api/anthropic
API_KEY=your-api-key
MODEL=glm-4.7

# Optional web tools API key (usually the same as API_KEY)
MOCHIKIT_WEB_API_KEY=your-api-key

# Set to 1 to run real LLM integration tests
MOCHIKIT_RUN_INTEGRATION=0
```

> Tip: GLM API keys look like `xxxxxxxx.xxxxxxxxxxxxxxxx`. Obtain one at the Zhipu Open Platform.
> All three variables -- `BASE_URL`, `API_KEY`, and `MODEL` -- are required.

### 3.1 Multi-Provider Configuration

MochiKit supports configuring **multiple LLM providers** simultaneously, automatically discovered via the `{NAME}_API_KEY` naming convention:

```dotenv
# === Default provider (no prefix, backward compatible) ===
API_KEY=your-glm-key
BASE_URL=https://open.bigmodel.cn/api/anthropic
MODEL=glm-4.7

# === Named providers ===
# DeepSeek
DEEPSEEK_API_KEY=sk-your-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# OpenAI
OPENAI_API_KEY=sk-your-openai-key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o
```

**Prefix rules**:
- Prefixes must be all **uppercase** (e.g., `DEEPSEEK`, `OPENAI`) and at least 2 characters.
- The framework automatically scans `process.env` for all variables matching `{PREFIX}_API_KEY` -- each prefix becomes a provider.
- Provider names are **case-insensitive** when calling `loadConfig()` (`'DeepSeek'`, `'deepseek'`, `'DEEPSEEK'` all work).

Selecting a specific provider:

```ts
import { loadConfig } from 'mochikit';

const glmCfg    = loadConfig();           // Default provider (bare API_KEY)
const deepCfg   = loadConfig('deepseek'); // DeepSeek provider
const openaiCfg = loadConfig('openai');   // OpenAI provider
```

## 4. Reading Configuration in Code

Use `loadConfig()` -- a single line:

```ts
import { loadConfig } from 'mochikit';

const cfg = loadConfig();
console.log(cfg.baseUrl); // https://open.bigmodel.cn/api/anthropic
console.log(cfg.model);   // glm-4.7
console.log(cfg.apiKey);  // your key

// Inspect all discovered providers
console.log(Object.keys(cfg.providers)); // ['default', 'deepseek', 'openai']
console.log(cfg.defaultProvider);        // 'default'
```

`loadConfig()` automatically loads `.env` and caches the result. It returns:

| Field | Description |
|---|---|
| `baseUrl` | LLM endpoint for the current provider |
| `apiKey` | LLM API key for the current provider |
| `model` | Default model name for the current provider |
| `webApiKey` | Web tools API key for the current provider |
| `runIntegration` | Whether integration tests are enabled |
| `defaultProvider` | Current provider name (`'default'` or other) |
| `providers` | Map of all discovered provider configurations |

> Note: Vite/Vitest environments preset `process.env.BASE_URL='/'`. MochiKit uses `override: true`
> when loading `.env` to ensure your configuration takes effect.

## 5. Running Your First Script

Create `hello.ts`:

```ts
import { Agent, AnthropicAdapter, loadConfig } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'hello',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You are a concise assistant.',
});

const answer = await agent.run('Describe TypeScript in one sentence.');
console.log(answer);
```

Run it:

```bash
npx tsx hello.ts
```

Expected output: a one-sentence description from the model.

### 5.1 Using Different Providers for Different Agents

```ts
const defaultCfg = loadConfig();
const deepCfg    = loadConfig('deepseek');

// Manager agent uses GLM
const manager = new Agent({
  name: 'manager',
  llm: new AnthropicAdapter({ apiKey: defaultCfg.apiKey, baseURL: defaultCfg.baseUrl }),
  model: defaultCfg.model,
  systemPrompt: 'You are a management assistant.',
});

// Worker agent uses DeepSeek
const worker = new Agent({
  name: 'worker',
  llm: new AnthropicAdapter({ apiKey: deepCfg.apiKey, baseURL: deepCfg.baseUrl }),
  model: deepCfg.model,
  systemPrompt: 'You are an efficient execution assistant.',
});
```

## 6. Directory Overview (Source Users)

```
MochiKit/
├── src/
│   ├── core/           # Engine core (Agent, loop, tools, hooks, permissions...)
│   ├── collaboration/  # Multi-agent collaboration
│   ├── memory/         # Memory and vectors
│   ├── tools/          # Built-in tools
│   ├── plugins/        # Plugins
│   └── infra/          # Message bus, tasks, configuration
├── examples/           # 5 runnable examples
├── tests/              # Unit + integration tests
├── Design/             # Architecture design docs
└── docs/               # Quick-reference usage docs
```

Next chapter: [02-First Agent](02-first-agent.md).
