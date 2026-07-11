import { describe, it, expect } from 'vitest';
import { ToolRegistry, toolFromFunction, normalizeName } from '../../src/index.js';

const echoDef = { name: 'echo', description: 'd', input_schema: { type: 'object', properties: {} } };

describe('ToolRegistry', () => {
  it('registers, lists, and dispatches', async () => {
    const reg = new ToolRegistry();
    reg.register(toolFromFunction(echoDef, async (input) => `hi ${input.name ?? ''}`));
    expect(reg.has('echo')).toBe(true);
    expect(reg.definitions()).toHaveLength(1);
    const out = await reg.dispatch(
      { type: 'tool_use', id: '1', name: 'echo', input: { name: 'bob' } },
      { agentName: 'a', cwd: '.' },
    );
    expect(out).toBe('hi bob');
  });

  it('returns error string for unknown tool', async () => {
    const reg = new ToolRegistry();
    const out = await reg.dispatch(
      { type: 'tool_use', id: '1', name: 'nope', input: {} },
      { agentName: 'a', cwd: '.' },
    );
    expect(out).toContain('unknown tool');
  });

  it('prevents duplicate registration', () => {
    const reg = new ToolRegistry();
    reg.register(toolFromFunction(echoDef, async () => 'x'));
    expect(() => reg.register(toolFromFunction(echoDef, async () => 'y'))).toThrow();
  });

  it('registerNamespaced prefixes names and normalizes', () => {
    const reg = new ToolRegistry();
    reg.registerNamespaced('mcp/github', toolFromFunction(
      { name: 'create issue', description: 'd', input_schema: { type: 'object', properties: {} } },
      async () => 'ok',
    ));
    expect(reg.has('mcp_github__create_issue')).toBe(true);
    expect(normalizeName('create issue!')).toBe('create_issue_');
  });
});
