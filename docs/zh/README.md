# MochiKit 开发文档

MochiKit 是一个基于 TypeScript + Node.js 的 AI Agent 开发框架。这份文档面向**普通开发者**，
目标是：看完就能用。文档不讲框架内部原理，只讲“怎么装、怎么用、怎么扩展”。

## 这份文档适合谁

- 会写 TypeScript / JavaScript 的后端或全栈开发者。
- 想用代码构建 AI Agent、多智能体协同、带记忆与工具的智能应用。
- 不需要了解 LLM 底层原理，只要会调用 API 即可。

## 阅读顺序

建议按顺序读前 7 章，即可完成一个能用的多智能体应用；其余按需查阅。

| 章节 | 主题 | 你将学会 |
|---|---|---|
| [01-安装与配置](01-安装与配置.md) | 安装、环境变量 | 跑通第一个项目 |
| [02-第一个Agent](02-第一个Agent.md) | 创建并运行 Agent | 让 Agent 回答问题 |
| [03-工具系统](03-工具系统.md) | 内置与自定义工具 | 让 Agent 调用代码 |
| [04-Skill加载系统](04-Skill加载系统.md) | 声明式 SKILL.md 文件 | 按需加载领域知识 |
| [05-记忆系统](05-记忆系统.md) | Markdown 记忆 | 让 Agent 记住事实 |
| [06-向量存储](06-向量存储.md) | 向量库与语义检索 | 接入相似度检索 |
| [07-多智能体-ManagerWorker](07-多智能体-ManagerWorker.md) | Manager-Worker 协同 | 任务委派 |
| [08-顺序链-SequentialChain](08-顺序链-SequentialChain.md) | 串联多个 Agent | 流水线处理 |
| [09-Team与信箱通信](09-Team与信箱通信.md) | 多 Agent 异步通信 | Agent 间互发消息 |
| [10-任务系统-TaskStore](10-任务系统-TaskStore.md) | 任务依赖图 | 拆解带依赖的任务 |
| [11-钩子-Hooks](11-钩子-Hooks.md) | 生命周期钩子 | 审计、改写、拦截 |
| [12-权限系统](12-权限系统.md) | 工具执行权限 | 安全控制 |
| [13-上下文压缩与错误恢复](13-上下文压缩与错误恢复.md) | 长对话与稳定性 | 避免爆上下文 |
| [14-插件系统](14-插件系统.md) | 打包复用能力 | 一次编写多处复用 |
| [15-Web工具](15-Web工具.md) | 联网搜索与阅读 | 让 Agent 上网 |
| [16-MCP集成](16-MCP集成.md) | MCP服务兼容 | 接入本地/远程工具服务 |
| [17-配置与环境变量](17-配置与环境变量.md) | 全部配置项 | 灵活部署 |
| [18-测试指南](18-测试指南.md) | 写测试 | 保证质量 |
| [19-完整实战示例](19-完整实战示例.md) | 综合实战 | 串起全部功能 |

## 约定

- 所有代码示例均为完整可复制的 TypeScript。
- 运行示例：`npx tsx 你的文件.ts`。
- import 路径用包名 `mochikit`（已发布时）或相对路径 `../src`（源码直接用时）。
- 框架默认支持 GLM 智谱的 Anthropic 兼容端点，也可用于任何 Anthropic 协议端点。

## 一句话速览

```ts
import { Agent, AnthropicAdapter, loadConfig, createBashTool, AllowAllResolver, PermissionManager } from 'mochikit';

const cfg = loadConfig();
const agent = new Agent({
  name: 'demo',
  llm: new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl }),
  model: cfg.model,
  systemPrompt: '你是一个简洁的助手。',
  tools: [createBashTool()],
  permission: new PermissionManager({ resolver: new AllowAllResolver() }),
});
console.log(await agent.run('用 bash 列出当前目录文件'));
```

更多见各章节。
