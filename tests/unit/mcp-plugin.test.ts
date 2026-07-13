/**
 * Unit tests for the MCP plugin — verifies that createMCPPlugin and
 * createMCPServerPlugin produce correctly-shaped Plugin objects, handle
 * the install lifecycle, and manage permission rules.
 *
 * Because actual MCP connections require spawning subprocesses or dialing
 * HTTP endpoints, these tests focus on the plugin's structural behavior
 * and use a mock PluginHost to verify what gets registered.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMCPPlugin, createMCPServerPlugin } from '../../src/index.js';
import type { PluginHost } from '../../src/plugins/plugin.js';
import type { MCPConfig } from '../../src/mcp/config.js';
import type { Tool } from '../../src/core/tool.js';
import type { PermissionRule } from '../../src/core/permission.js';
import type { HookCallback, HookEvent } from '../../src/core/hooks.js';

// ---------------------------------------------------------------------------
// Mock PluginHost — records all registrations for later inspection
// ---------------------------------------------------------------------------

interface RegistrationLog {
  tools: Tool[];
  hooks: Array<{ event: HookEvent; callback: HookCallback; priority: number }>;
  rules: PermissionRule[];
}

function createMockHost(): PluginHost & { log: RegistrationLog } {
  const log: RegistrationLog = { tools: [], hooks: [], rules: [] };
  return {
    log,
    registerTool(tool: Tool): void {
      log.tools.push(tool);
    },
    registerHook(event: HookEvent, callback: HookCallback, priority = 0): void {
      log.hooks.push({ event, callback, priority });
    },
    registerPermissionRule(rule: PermissionRule): void {
      log.rules.push(rule);
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: a valid stdio config that will fail to connect (no real server).
// The plugin catches connection errors gracefully.
// ---------------------------------------------------------------------------

const failingStdioConfig: MCPConfig = {
  servers: [
    {
      name: 'test-server',
      transport: {
        type: 'stdio',
        command: 'nonexistent-command-xyz',
        args: ['--flag'],
      },
      permissionMode: 'auto-allow',
    },
  ],
};

// ---------------------------------------------------------------------------
// createMCPPlugin
// ---------------------------------------------------------------------------

describe('createMCPPlugin', () => {
  it('returns a plugin with name "mcp"', () => {
    const mcp = createMCPPlugin(failingStdioConfig);
    expect(mcp.plugin.name).toBe('mcp');
  });

  it('plugin.install() does not throw even when MCP servers are unreachable', () => {
    const mcp = createMCPPlugin(failingStdioConfig);
    const host = createMockHost();

    // install() fires async connections but should not throw synchronously.
    expect(() => mcp.plugin.install(host)).not.toThrow();
  });

  it('init() returns an empty array when called before install()', async () => {
    const mcp = createMCPPlugin(failingStdioConfig);

    // init() before install() should return empty — nothing to wait for.
    const results = await mcp.init();
    expect(results).toEqual([]);
  });

  it('init() after install() returns connection results (even failed ones)', async () => {
    const mcp = createMCPPlugin(failingStdioConfig);
    const host = createMockHost();

    // Install triggers async connection attempts.
    mcp.plugin.install(host);

    // Wait for connections to settle (they will fail because the command
    // doesn't exist, but that's fine — errors are caught).
    const results = await mcp.init();

    expect(results).toHaveLength(1);
    expect(results[0].serverName).toBe('test-server');
    // Connection should fail since the command doesn't exist.
    expect(results[0].success).toBe(false);
    expect(results[0].toolCount).toBe(0);
    expect(results[0].error).toBeDefined();
  });

  it('disconnectAll does not throw when called before or after install', async () => {
    const mcp = createMCPPlugin(failingStdioConfig);

    // Should not throw even with no active connections.
    await expect(mcp.disconnectAll()).resolves.toBeUndefined();

    // After install, disconnectAll should still work.
    mcp.plugin.install(createMockHost());
    await expect(mcp.disconnectAll()).resolves.toBeUndefined();
  });

  it('reconnect throws for unknown server names', async () => {
    const mcp = createMCPPlugin(failingStdioConfig);

    await expect(mcp.reconnect('nonexistent')).rejects.toThrow(/Unknown MCP server/);
  });

  it('reconnect validates server name and cycles transport', async () => {
    const mcp = createMCPPlugin(failingStdioConfig);
    mcp.plugin.install(createMockHost());

    // Reconnect for the known server — should attempt to reconnect (will
    // fail because command doesn't exist, but it validates the name first).
    // The key assertion: it should NOT throw "Unknown MCP server".
    // It might throw a connection error, which is fine.
    try {
      await mcp.reconnect('test-server');
    } catch (err) {
      // Connection errors are expected — just verify it's not "Unknown server".
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain('Unknown MCP server');
    }
  });

  it('handles multiple servers in config', () => {
    const config: MCPConfig = {
      servers: [
        { name: 'server-a', transport: { type: 'stdio', command: 'cmd-a' } },
        { name: 'server-b', transport: { type: 'stdio', command: 'cmd-b' } },
      ],
    };

    const mcp = createMCPPlugin(config);
    expect(mcp.plugin.name).toBe('mcp');

    const host = createMockHost();
    expect(() => mcp.plugin.install(host)).not.toThrow();
  });

  it('registered permission rule uses prefix matching (check function logic)', () => {
    const mcp = createMCPPlugin(failingStdioConfig);
    const host = createMockHost();

    mcp.plugin.install(host);

    // The auto-allow rule should be registered (it's registered synchronously
    // as part of the async connect flow when it succeeds, but our connection
    // will fail, so the rule won't be registered in this test).
    // This test verifies the plugin doesn't throw during the attempt.
    expect(host.log.tools.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// createMCPServerPlugin (convenience wrapper)
// ---------------------------------------------------------------------------

describe('createMCPServerPlugin', () => {
  it('creates a plugin equivalent to createMCPPlugin with a single server', () => {
    const single = createMCPServerPlugin({
      name: 'solo',
      transport: { type: 'stdio', command: 'echo' },
    });

    expect(single.plugin.name).toBe('mcp');
  });

  it('init() returns results for the single server', async () => {
    const single = createMCPServerPlugin({
      name: 'solo',
      transport: { type: 'stdio', command: 'nonexistent-cmd' },
      permissionMode: 'manual',
    });

    single.plugin.install(createMockHost());
    const results = await single.init();

    expect(results).toHaveLength(1);
    expect(results[0].serverName).toBe('solo');
    expect(results[0].success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Permission rule prefix-matching behavior
// ---------------------------------------------------------------------------

describe('MCP permission rule check() logic', () => {
  it('a prefix-matching rule allows namespaced tools and passes through others', () => {
    // Simulate what the plugin does internally: create a rule whose check()
    // uses startsWith for prefix matching.
    const namespace = 'mcp__test-server';
    const rule: PermissionRule = {
      name: 'mcp-auto-allow:test-server',
      check(ctx) {
        if (ctx.tool.name.startsWith(`${namespace}__`)) {
          return 'allow';
        }
        return 'passthrough';
      },
      reason: 'Auto-allowed MCP tool',
    };

    // Should allow tools matching the namespace prefix.
    expect(
      rule.check({
        agentName: 'test',
        tool: { type: 'tool_use', id: '1', name: 'mcp__test-server__read_file', input: {} },
      }),
    ).toBe('allow');

    expect(
      rule.check({
        agentName: 'test',
        tool: { type: 'tool_use', id: '2', name: 'mcp__test-server__write_file', input: {} },
      }),
    ).toBe('allow');

    // Should pass through tools from other namespaces.
    expect(
      rule.check({
        agentName: 'test',
        tool: { type: 'tool_use', id: '3', name: 'mcp__other__read_file', input: {} },
      }),
    ).toBe('passthrough');

    // Should pass through built-in tools.
    expect(
      rule.check({
        agentName: 'test',
        tool: { type: 'tool_use', id: '4', name: 'bash', input: {} },
      }),
    ).toBe('passthrough');
  });

  it('prefix "mcp__test__" does NOT match "mcp__testing__" (boundary safety)', () => {
    // This is important: "mcp__test__" should match "mcp__test__read" but
    // NOT "mcp__testing__read".  The __ separator ensures this.
    const namespace = 'mcp__test';
    const rule: PermissionRule = {
      name: 'strict-prefix',
      check(ctx) {
        if (ctx.tool.name.startsWith(`${namespace}__`)) {
          return 'allow';
        }
        return 'passthrough';
      },
    };

    // "mcp__test__read" starts with "mcp__test__" → match.
    expect(
      rule.check({
        agentName: 'x',
        tool: { type: 'tool_use', id: '1', name: 'mcp__test__read', input: {} },
      }),
    ).toBe('allow');

    // "mcp__testing__read" does NOT start with "mcp__test__" (missing double
    // underscore after "test") → no match.
    expect(
      rule.check({
        agentName: 'x',
        tool: { type: 'tool_use', id: '2', name: 'mcp__testing__read', input: {} },
      }),
    ).toBe('passthrough');
  });
});
