/**
 * Unit tests for the MCP tool adapter — verifies that MCP tool definitions
 * from `tools/list` are correctly converted to MochiKit Tool instances.
 */

import { describe, it, expect, vi } from 'vitest';
import { mcpToolToMochiKit, mcpToolsToMochiKit, ToolRegistry } from '../../src/index.js';
import type { McpToolDefinition } from '../../src/mcp/transport.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid MCP tool definition for testing. */
const sampleTool: McpToolDefinition = {
  name: 'search',
  description: 'Search the documentation index.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
    },
    required: ['query'],
  },
};

/** A mock caller that echoes back the tool name and arguments as JSON. */
function echoCaller(toolName: string, args: Record<string, unknown>): Promise<string> {
  return Promise.resolve(JSON.stringify({ toolName, args }));
}

// ---------------------------------------------------------------------------
// mcpToolToMochiKit
// ---------------------------------------------------------------------------

describe('mcpToolToMochiKit', () => {
  it('converts a single MCP tool to a MochiKit Tool with correct definition shape', () => {
    const tool = mcpToolToMochiKit('docs', sampleTool, echoCaller);

    expect(tool.definition.name).toBe('search');
    expect(tool.definition.description).toContain('[MCP:docs]');
    expect(tool.definition.description).toContain('Search the documentation index.');
    expect(tool.definition.input_schema).toEqual(sampleTool.inputSchema);
  });

  it('execute delegates to the caller callback with correct arguments', async () => {
    const caller = vi.fn().mockResolvedValue('result-from-caller');
    const tool = mcpToolToMochiKit('docs', sampleTool, caller);

    const result = await tool.execute(
      { query: 'agent loop' },
      { agentName: 'test', cwd: '.' },
    );

    expect(result).toBe('result-from-caller');
    expect(caller).toHaveBeenCalledTimes(1);
    expect(caller).toHaveBeenCalledWith('search', { query: 'agent loop' });
  });

  it('execute catches caller errors and returns an error string (never throws)', async () => {
    const caller = vi.fn().mockRejectedValue(new Error('Connection refused'));
    const tool = mcpToolToMochiKit('docs', sampleTool, caller);

    const result = await tool.execute(
      { query: 'test' },
      { agentName: 'test', cwd: '.' },
    );

    // Should return an error string, NOT throw.
    expect(result).toContain('[MCP Error');
    expect(result).toContain('docs/search');
    expect(result).toContain('Connection refused');
  });

  it('handles missing inputSchema gracefully by providing a default empty object schema', () => {
    const toolWithoutSchema: McpToolDefinition = {
      name: 'simple_tool',
      description: 'A tool without an explicit schema.',
    };

    const tool = mcpToolToMochiKit('minimal', toolWithoutSchema, echoCaller);

    expect(tool.definition.input_schema).toEqual({
      type: 'object',
      properties: {},
      required: [],
    });
  });

  it('handles missing description by using the tool name as fallback', () => {
    const toolWithoutDesc: McpToolDefinition = {
      name: 'unnamed_tool',
    };

    const tool = mcpToolToMochiKit('test', toolWithoutDesc, echoCaller);

    expect(tool.definition.description).toBe('[MCP:test] unnamed_tool');
  });

  it('marks all MCP tools as NOT concurrency-safe (conservative default)', () => {
    const tool = mcpToolToMochiKit('docs', sampleTool, echoCaller);

    expect(tool.isConcurrencySafe?.()).toBe(false);
  });

  it('registered and dispatched via ToolRegistry.registerNamespaced works correctly', async () => {
    const reg = new ToolRegistry();
    const tool = mcpToolToMochiKit('docs', sampleTool, echoCaller);

    // Register with namespace — this is how createMCPPlugin does it.
    reg.registerNamespaced('mcp__docs', tool);

    // The namespaced name should be registered.
    const expectedName = 'mcp__docs__search';
    expect(reg.has(expectedName)).toBe(true);

    // Dispatch should work via the namespaced name.
    const output = await reg.dispatch(
      { type: 'tool_use', id: '1', name: expectedName, input: { query: 'hello' } },
      { agentName: 'test', cwd: '.' },
    );
    const parsed = JSON.parse(output);
    expect(parsed.toolName).toBe('search');
    expect(parsed.args.query).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// mcpToolsToMochiKit
// ---------------------------------------------------------------------------

describe('mcpToolsToMochiKit', () => {
  it('converts multiple tools via the batch helper', () => {
    const mcpTools: McpToolDefinition[] = [
      { name: 'tool_a', description: 'First tool.' },
      { name: 'tool_b', description: 'Second tool.' },
    ];

    const tools = mcpToolsToMochiKit('batch', mcpTools, echoCaller);

    expect(tools).toHaveLength(2);
    expect(tools[0].definition.name).toBe('tool_a');
    expect(tools[1].definition.name).toBe('tool_b');
    expect(tools[0].definition.description).toContain('[MCP:batch]');
    expect(tools[1].definition.description).toContain('[MCP:batch]');
  });

  it('returns an empty array when given an empty tool list', () => {
    const tools = mcpToolsToMochiKit('empty', [], echoCaller);
    expect(tools).toHaveLength(0);
  });

  it('each tool has an independent executor bound to its own name', async () => {
    const caller = vi
      .fn()
      .mockImplementation((name: string, _args: Record<string, unknown>) =>
        Promise.resolve(`called ${name}`),
      );

    const mcpTools: McpToolDefinition[] = [
      { name: 'read', description: 'Read file.' },
      { name: 'write', description: 'Write file.' },
    ];

    const tools = mcpToolsToMochiKit('fs', mcpTools, caller);

    // Call both tools independently.
    const r1 = await tools[0].execute({ path: '/a' }, { agentName: 't', cwd: '.' });
    const r2 = await tools[1].execute({ path: '/b', content: 'x' }, { agentName: 't', cwd: '.' });

    expect(r1).toBe('called read');
    expect(r2).toBe('called write');
    expect(caller).toHaveBeenCalledTimes(2);
  });
});
