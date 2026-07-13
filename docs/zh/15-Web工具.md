# 14 - Web 工具

本章你将学会：让 Agent 联网搜索、阅读网页（基于 GLM 智谱的 Web 工具 API）。

MochiKit 内置两个网络工具，封装自 GLM 的 `web_search` 与 `reader` 接口。

## 1. WebSearch（网络搜索）

```ts
import { createWebSearchTool } from 'mochikit';

const webSearch = createWebSearchTool('你的-api-key'); // 通常 = cfg.webApiKey
const result = await webSearch.execute({ search_query: 'TypeScript 5 release notes' });
console.log(result);
```

参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `search_query` | 是 | 搜索词，最长 70 字符 |
| `search_engine` | 否 | `search_std`（默认）/ `search_pro` / `search_pro_sogou` / `search_pro_quark` |
| `count` | 否 | 结果数 1–50，默认 10 |
| `search_recency_filter` | 否 | `oneDay`/`oneWeek`/`oneMonth`/`oneYear`/`noLimit` |

返回格式化文本：每条结果含标题、链接、摘要。

## 2. WebReader（网页阅读）

```ts
import { createWebReaderTool } from 'mochikit';

const webReader = createWebReaderTool('你的-api-key');
const content = await webReader.execute({ url: 'https://example.com' });
console.log(content);
```

参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `url` | 是 | 要抓取的网址 |
| `return_format` | 否 | `markdown`（默认）/ `text` |
| `timeout` | 否 | 超时秒数 |

返回网页标题 + 解析后的正文（Markdown）。

## 3. 装到 Agent

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
  systemPrompt: '你可以联网。用 web_search 搜索，用 web_reader 阅读网页。',
  tools: [
    createWebSearchTool(cfg.webApiKey),
    createWebReaderTool(cfg.webApiKey),
  ],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});

console.log(await agent.run('搜一下 MochiKit 是什么，并阅读第一个结果的页面。'));
```

模型会自主决定先搜索、再选链接阅读。

## 4. 直接用工具（不经 Agent）

工具本质是个函数，可以直接调用：

```ts
const out = await createWebSearchTool(cfg.webApiKey).execute({ search_query: '今天新闻' });
```

## 5. 错误处理

- API 限流（错误码 1701/1702/1703）时，工具返回 `Error 17xx: ...` 字符串而非抛异常，
  Agent 据此可改用其他方式。
- 网络异常会抛错，被 AgentLoop 捕获为工具错误结果。

下一章：[17-配置与环境变量](17-配置与环境变量.md)。
