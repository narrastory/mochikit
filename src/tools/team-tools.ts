/**
 * Team communication tools — `send_message` and `check_inbox` backed by a
 * MessageBus (tutorial s15/s16).
 *
 * ## Mailbox communication pattern
 *
 * Team members communicate via consumable inboxes.  Each agent has its own
 * FIFO mailbox managed by a {@link MessageBus}.  Messages are **consumed on
 * read** — once `check_inbox` returns a message, it is gone from the
 * mailbox.  This destructive read simplifies coordination: the agent
 * always sees the next unhandled message without needing to track offsets.
 *
 * The pattern supports several message types ({@link MessageType}) for
 * different collaboration protocols:
 * - `message` / `result` — general-purpose communication.
 * - `shutdown_request` / `shutdown_response` — graceful teardown handshake.
 * - `plan_approval_request` / `plan_approval_response` — Manager-Worker
 *   approval flow (s16).
 */

import { BaseTool } from '../core/tool.js';
import type { MessageBus } from '../infra/message-bus.js';
import type { MessageType } from '../infra/message-bus.js';

/**
 * Tool that sends a message to another agent's inbox via the
 * {@link MessageBus}.
 *
 * The caller specifies a recipient agent name, message content, and
 * optional type / metadata.  The message is timestamped automatically
 * by the bus and delivered to the recipient's FIFO inbox.
 */
export class SendMessageTool extends BaseTool {
  readonly definition = {
    name: 'send_message',
    description: 'Send a message to another agent by name.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient agent name' },
        content: { type: 'string', description: 'Message body' },
        type: {
          type: 'string',
          enum: ['message', 'result', 'shutdown_request', 'shutdown_response', 'plan_approval_request', 'plan_approval_response'],
          description: 'Message type',
        },
        request_id: { type: 'string', description: 'Optional request ID for protocol tracking (s16)' },
        metadata: { type: 'object', description: 'Optional metadata (approve, etc.)' },
      },
      required: ['to', 'content'],
    },
  };

  /**
   * @param bus - The {@link MessageBus} to deliver messages through.
   * @param from - The name of the agent sending the message (set at
   *   construction time by the factory).
   */
  constructor(private bus: MessageBus, private from: string) {
    super();
  }

  /**
   * Deliver a message to another agent's inbox.
   *
   * @param input - Raw input from the model.
   *   - `to` (string, required) — Recipient agent name.
   *   - `content` (string, required) — Message body text.
   *   - `type` (string, optional) — Message type from the
   *     {@link MessageType} enum.  Defaults to `"message"`.
   *   - `request_id` (string, optional) — Correlation ID for protocol
   *     tracking (s16).
   *   - `metadata` (object, optional) — Arbitrary key-value payload
   *     (e.g. `{ approve: true }`).
   * @returns A short confirmation string (e.g. `"Sent message to alice."`).
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    const to = this.requireString(input, 'to');
    const content = this.requireString(input, 'content');
    const type = (this.optionalString(input, 'type') ?? 'message') as MessageType;
    const metadata = (input.metadata as Record<string, unknown>) ?? {};
    await this.bus.send({ from: this.from, to, content, type, metadata });
    return `Sent ${type} to ${to}.`;
  }
}

/**
 * Tool that reads and consumes all messages from the calling agent's
 * inbox.
 *
 * This is a **destructive read**: once messages are returned they are
 * removed from the inbox and will not appear on the next call.  The agent
 * is responsible for acting on each message before calling `check_inbox`
 * again.
 */
export class CheckInboxTool extends BaseTool {
  readonly definition = {
    name: 'check_inbox',
    description: 'Read and consume all messages in this agent inbox.',
    input_schema: { type: 'object', properties: {} },
  };

  /**
   * @param bus - The {@link MessageBus} to read from.
   * @param agent - The agent's own name (set at construction time by the
   *   factory), used as the inbox key.
   */
  constructor(private bus: MessageBus, private agent: string) {
    super();
  }

  /**
   * Drain the agent's inbox and return all pending messages.
   *
   * @returns A newline-separated list of messages with their type,
   *   sender, and content, or `"Inbox empty."` if no messages are
   *   waiting.
   */
  async execute(): Promise<string> {
    const msgs = await this.bus.readInbox(this.agent);
    if (msgs.length === 0) return 'Inbox empty.';
    return msgs
      .map((m) => `[${m.type}] from ${m.from}: ${m.content}`)
      .join('\n');
  }
}

/**
 * Factory that creates the team communication tool suite.
 *
 * Both tools are wired to the same {@link MessageBus} and share the
 * agent's identity so that `SendMessageTool` stamps outgoing messages with
 * the correct sender name and `CheckInboxTool` reads the correct inbox.
 *
 * @param bus - The {@link MessageBus} shared by all team members.
 * @param agentName - The calling agent's own name.
 * @returns An array of `[SendMessageTool, CheckInboxTool]`.
 */
export function createTeamTools(bus: MessageBus, agentName: string): Array<SendMessageTool | CheckInboxTool> {
  return [new SendMessageTool(bus, agentName), new CheckInboxTool(bus, agentName)];
}
