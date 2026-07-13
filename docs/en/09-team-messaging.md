# 08 - Team and Message-Bus Communication

In this chapter you will learn: how to have multiple agents message each other like team members.

## 1. What Is a Team

`Team` organizes a group of agents into a "team," where each member automatically receives `send_message` and `check_inbox`
tools and communicates asynchronously via a **message bus** — just like each one has a mailbox.

Unlike Manager-Worker: there is no "manager" in a Team; members are peers who collaborate through messaging.

## 2. Creating a Team

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
  bus: new InMemoryMessageBus(), // default is an in-memory bus if not provided
});

// Have alice handle a task; during execution she may message bob
const out = await team.run('alice', '把一句问候转达给 bob，并把他的回复告诉我。');
console.log(out);
```

When constructing a Team, each member automatically registers `send_message` / `check_inbox` tools bound to its own name.

## 3. Direct Message Bus Operations

You can also send and receive messages directly from code:

```ts
import { InMemoryMessageBus, FileMessageBus } from 'mochikit';

const bus = new InMemoryMessageBus();

// Send
await bus.send({ from: 'alice', to: 'bob', content: 'hi', type: 'message' });

// Peek (non-destructive)
const peek = await bus.peekInbox('bob');

// Read and consume (empties the inbox after reading)
const msgs = await bus.readInbox('bob');
console.log(msgs[0].content); // 'hi'
```

Message structure:

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

## 4. File-Based Mailbox (Persistence)

`FileMessageBus` stores each member's inbox as a JSONL file, enabling cross-process communication:

```ts
import { FileMessageBus } from 'mochikit';

const bus = new FileMessageBus('./.mochikit/mailbox');
```

Each member's inbox lives at `./.mochikit/mailbox/{name}.jsonl`, with process-level locking for concurrency safety.

## 5. Message Types and Protocols

The `type` field distinguishes the purpose:

- `message`: ordinary message
- `result`: task result return
- `shutdown_request` / `shutdown_response`: request / confirm shutdown
- `plan_approval_request` / `plan_approval_response`: plan approval

You can build custom collaboration protocols on top of these types.

## Team Protocol State Machine

MochiKit includes a built-in team protocol system (`src/collaboration/protocols.ts`) that supports two structured protocols:

### Shutdown Protocol

A Lead requests a teammate to gracefully shut down:

```ts
import { ProtocolManager } from 'mochikit';

const protocols = new ProtocolManager();
const reqId = protocols.createRequest('shutdown', 'lead', 'worker', 'Please shut down');
// Send a shutdown_request message
// After the teammate replies with shutdown_response, update state via handleResponse
const result = protocols.handleResponse('shutdown_response', reqId, true);
// result.status === 'approved'
```

### Plan Approval Protocol

Before starting a high-risk operation, a teammate submits a plan for the Lead to approve:

```ts
const reqId = protocols.createRequest('plan_approval', 'worker', 'lead', planText);
// Lead approves
protocols.handleResponse('plan_approval_response', reqId, true); // approved
```

The `send_message` tool now supports `request_id` and `metadata` parameters for correlating requests and responses.

Next chapter: [10-Task System](10-task-system.md).
