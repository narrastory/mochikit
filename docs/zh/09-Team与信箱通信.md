# 08 - Team 与信箱通信

本章你将学会：让多个 Agent 像团队成员一样互发消息。

## 1. Team 是什么

`Team` 把一组 Agent 组织到一个“团队”里，每个成员自动获得 `send_message` / `check_inbox` 两个工具，
通过**消息总线（MessageBus）**异步通信——就像各自有一个信箱。

与 Manager-Worker 不同：Team 里没有“管理者”，成员之间是平等的、靠消息协作。

## 2. 创建 Team

```ts
import {
  Agent, AnthropicAdapter, loadConfig, Team, InMemoryMessageBus,
  AllowAllResolver, PermissionManager,
} from 'mochikit';

const cfg = loadConfig();
const llm = () => new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
const perm = () => new PermissionManager({ resolver: new AllowAllResolver() });

const alice = new Agent({
  name: 'alice', llm: llm(), model: cfg.model, permission: perm(), maxTurns: 4,
  systemPrompt: '你是 alice。需要时用 send_message 给 bob 发消息，用 check_inbox 收消息。',
});
const bob = new Agent({
  name: 'bob', llm: llm(), model: cfg.model, permission: perm(), maxTurns: 4,
  systemPrompt: '你是 bob。收到消息后回复 alice。',
});

const team = new Team({
  members: [alice, bob],
  bus: new InMemoryMessageBus(), // 不传则默认用内存总线
});

// 让 alice 处理一个任务，过程中她可能给 bob 发消息
const out = await team.run('alice', '把一句问候转达给 bob，并把他的回复告诉我。');
console.log(out);
```

构造 Team 时，每个成员会自动注册 `send_message` / `check_inbox` 工具，绑定到自己的名字。

## 3. 直接操作消息总线

你也可以在代码里直接收发消息：

```ts
import { InMemoryMessageBus, FileMessageBus } from 'mochikit';

const bus = new InMemoryMessageBus();

// 发送
await bus.send({ from: 'alice', to: 'bob', content: 'hi', type: 'message' });

// 偷看（不消费）
const peek = await bus.peekInbox('bob');

// 读取并消费（读完信箱清空）
const msgs = await bus.readInbox('bob');
console.log(msgs[0].content); // 'hi'
```

消息结构：

```ts
interface BusMessage {
  from: string;
  to: string;
  content: string;
  type: 'message' | 'result' | 'shutdown_request' | 'shutdown_response'
      | 'plan_approval_request' | 'plan_approval_response';
  ts: number;
  metadata?: Record<string, unknown>;
}
```

## 4. 文件信箱（持久化）

`FileMessageBus` 把每个成员的信箱存为 JSONL 文件，跨进程也能通信：

```ts
import { FileMessageBus } from 'mochikit';

const bus = new FileMessageBus('./.mochikit/mailbox');
```

每个成员的信箱是 `./.mochikit/mailbox/{name}.jsonl`，带进程级锁，并发安全。

## 5. 消息类型与协议

`type` 字段用于区分用途：

- `message`：普通消息
- `result`：任务结果回传
- `shutdown_request` / `shutdown_response`：请求关闭 / 确认关闭
- `plan_approval_request` / `plan_approval_response`：计划审批

你可以基于这些类型实现自定义的协作协议。

## Team 协议状态机

MochiKit 内置了团队协议系统（`src/collaboration/protocols.ts`），支持两种结构化协议：

### 关机协议

Lead 请求队友优雅关机：

```ts
import { ProtocolManager } from 'mochikit';

const protocols = new ProtocolManager();
const reqId = protocols.createRequest('shutdown', 'lead', 'worker', 'Please shut down');
// 发送 shutdown_request 消息
// 队友回复 shutdown_response 后，通过 handleResponse 更新状态
const result = protocols.handleResponse('shutdown_response', reqId, true);
// result.status === 'approved'
```

### 计划审批协议

队友在开始高风险操作前，提交计划给 Lead 审批：

```ts
const reqId = protocols.createRequest('plan_approval', 'worker', 'lead', planText);
// Lead 审批
protocols.handleResponse('plan_approval_response', reqId, true); // approved
```

`send_message` 工具现在支持 `request_id` 和 `metadata` 参数，用于关联请求和响应。

下一章：[10-任务系统-TaskStore](10-任务系统-TaskStore.md)。
