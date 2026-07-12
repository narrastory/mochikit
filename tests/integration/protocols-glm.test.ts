import { describe, it, expect } from 'vitest';
import {
  Agent, PermissionManager, AllowAllResolver,
  ProtocolManager, InMemoryMessageBus,
  createTeamTools,
} from '../../src/index.js';
import { glmClient, MODEL, runIntegration } from './helpers.js';

describe.skipIf(!runIntegration)('Team Protocols — real GLM', () => {
  it('protocol state machine tracks request lifecycle', () => {
    // This tests the ProtocolManager directly (no LLM needed)
    const pm = new ProtocolManager();

    // Create a shutdown request
    const reqId = pm.createRequest('shutdown', 'lead', 'worker', 'Stop now');
    expect(reqId).toMatch(/^req_\d{6}$/);
    expect(pm.listPending()).toHaveLength(1);

    // Worker responds
    const result = pm.handleResponse('shutdown_response', reqId, true);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('approved');
    expect(pm.listPending()).toHaveLength(0);
  });

  it('team agents can communicate via message bus', async () => {
    const bus = new InMemoryMessageBus();
    const shared = new PermissionManager({ resolver: new AllowAllResolver() });

    const alice = new Agent({
      name: 'alice',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You are Alice. Use send_message to send a brief greeting to Bob.' +
        ' Then check_inbox for replies. Be concise.',
      tools: createTeamTools(bus, 'alice'),
      permission: shared,
      maxTurns: 3,
    });

    const bob = new Agent({
      name: 'bob',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You are Bob. Check your inbox, and if you receive a message, reply with a brief greeting back.' +
        ' Be concise.',
      tools: createTeamTools(bus, 'bob'),
      permission: shared,
      maxTurns: 3,
    });

    // Alice sends a message to Bob
    const aliceResult = await alice.run('Send a friendly greeting to Bob via send_message.');
    expect(aliceResult.length).toBeGreaterThan(5);
    console.log('[alice] output:', aliceResult.slice(0, 200));

    // Bob reads and responds
    const bobResult = await bob.run('Check your inbox and reply to any messages.');
    expect(bobResult.length).toBeGreaterThan(5);
    console.log('[bob] output:', bobResult.slice(0, 200));
  }, 180_000);
});
