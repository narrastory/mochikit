# 14 - Web Tools

In this chapter you will learn how to give your Agent internet search and web page reading capabilities (based on GLM Zhipu's Web Tools API).

MochiKit ships with two built-in web tools that wrap GLM's `web_search` and `reader` interfaces.

## 1. WebSearch (Internet Search)

```ts
import { createWebSearchTool } from 'mochikit';

const webSearch = createWebSearchTool('your-api-key'); // typically = cfg.webApiKey
const result = await webSearch.execute({ search_query: 'TypeScript 5 release notes' });
console.log(result);
```

Parameters:

| Parameter | Required | Description |
|---|---|---|
| `search_query` | Yes | Search query, max 70 characters |
| `search_engine` | No | `search_std` (default) / `search_pro` / `search_pro_sogou` / `search_pro_quark` |
| `count` | No | Number of results 1–50, default 10 |
| `search_recency_filter` | No | `oneDay` / `oneWeek` / `oneMonth` / `oneYear` / `noLimit` |

Returns formatted text: each result includes title, link, and snippet.

## 2. WebReader (Page Reader)

```ts
import { createWebReaderTool } from 'mochikit';

const webReader = createWebReaderTool('your-api-key');
const content = await webReader.execute({ url: 'https://example.com' });
console.log(content);
```

Parameters:

| Parameter | Required | Description |
|---|---|---|
| `url` | Yes | The URL to fetch |
| `return_format` | No | `markdown` (default) / `text` |
| `timeout` | No | Timeout in seconds |

Returns the page title + parsed body (Markdown).

## 3. Installing on an Agent

```ts
import {
  Agent, AnthropicAdapter, loadConfig,
  createWebSearchTool, createWebReaderTool,
  AllowAllResolver, PermissionManager,
} from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'web-agent',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: 'You have internet access. Use web_search to search and web_reader to read pages.',
  tools: [
    createWebSearchTool(cfg.webApiKey),
    createWebReaderTool(cfg.webApiKey),
  ],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

console.log(await agent.run('Search for what MochiKit is and read the first result page.'));
```

The model will autonomously decide to search first, then pick a link to read.

## 4. Using Tools Directly (Without an Agent)

Tools are essentially functions and can be called directly:

```ts
const out = await createWebSearchTool(cfg.webApiKey).execute({ search_query: 'today news' });
```

## 5. Error Handling

- On API rate limiting (error codes 1701/1702/1703), the tool returns an `Error 17xx: ...` string instead of throwing an exception, allowing the Agent to fall back to other approaches.
- Network exceptions are thrown and caught by AgentLoop as tool error results.

Next chapter: [17-Config & Env Vars](17-config-and-env-vars.md).
