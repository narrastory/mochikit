/**
 * Team communication tools — `send_message` and `check_inbox` backed by a
 * MessageBus (tutorial s15/s16).
 */

import { BaseTool } from '../core/tool.js';
import type { MessageBus } from '../infra/message-bus.js';
import type { MessageType } from '../infra/message-bus.js';

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

  constructor(private bus: MessageBus, private from: string) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const to = this.requireString(input, 'to');
    const content = this.requireString(input, 'content');
    const type = (this.optionalString(input, 'type') ?? 'message') as MessageType;
    const metadata = (input.metadata as Record<string, unknown>) ?? {};
    await this.bus.send({ from: this.from, to, content, type, metadata });
    return `Sent ${type} to ${to}.`;
  }
}

export class CheckInboxTool extends BaseTool {
  readonly definition = {
    name: 'check_inbox',
    description: 'Read and consume all messages in this agent inbox.',
    input_schema: { type: 'object', properties: {} },
  };

  constructor(private bus: MessageBus, private agent: string) {
    super();
  }

  async execute(): Promise<string> {
    const msgs = await this.bus.readInbox(this.agent);
    if (msgs.length === 0) return 'Inbox empty.';
    return msgs
      .map((m) => `[${m.type}] from ${m.from}: ${m.content}`)
      .join('\n');
  }
}

export function createTeamTools(bus: MessageBus, agentName: string): Array<SendMessageTool | CheckInboxTool> {
  return [new SendMessageTool(bus, agentName), new CheckInboxTool(bus, agentName)];
}
