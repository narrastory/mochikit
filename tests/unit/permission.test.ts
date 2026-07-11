import { describe, it, expect } from 'vitest';
import { PermissionManager, AllowAllResolver, DenyAllResolver } from '../../src/index.js';

const bashBlock = { type: 'tool_use', id: '1', name: 'bash', input: { command: 'rm -rf /' } } as const;
const readBlock = { type: 'tool_use', id: '2', name: 'read_file', input: { path: '/tmp/x' } } as const;

describe('PermissionManager', () => {
  it('deny rule blocks immediately', async () => {
    const pm = new PermissionManager({
      rules: [
        {
          name: 'no-rm-rf',
          tools: ['bash'],
          check: (ctx) => (String(ctx.tool.input.command).includes('rm -rf /') ? 'deny' : 'passthrough'),
          reason: 'destructive',
        },
      ],
    });
    const v = await pm.check({ agentName: 'a', tool: bashBlock });
    expect(v.decision).toBe('deny');
  });

  it('ask escalates to resolver', async () => {
    const pm = new PermissionManager({
      rules: [
        {
          name: 'ask-read',
          tools: ['read_file'],
          check: () => 'ask' as const,
          reason: 'reads file',
        },
      ],
      resolver: new AllowAllResolver(),
    });
    const v = await pm.check({ agentName: 'a', tool: readBlock });
    expect(v.decision).toBe('allow');
  });

  it('falls through to allow when no rule objects', async () => {
    const pm = new PermissionManager({ resolver: new DenyAllResolver() });
    const v = await pm.check({ agentName: 'a', tool: readBlock });
    expect(v.decision).toBe('allow');
  });
});
