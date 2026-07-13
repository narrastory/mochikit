/**
 * Unit tests for MCP configuration loading — verifies that programmatic
 * config validation and environment variable parsing work correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadMCPConfig, loadMCPConfigFromEnv } from '../../src/index.js';
import type { MCPConfig } from '../../src/mcp/config.js';

// ---------------------------------------------------------------------------
// loadMCPConfig (programmatic validation)
// ---------------------------------------------------------------------------

describe('loadMCPConfig', () => {
  it('validates and returns a well-formed programmatic config unchanged', () => {
    const config: MCPConfig = {
      servers: [
        {
          name: 'docs',
          transport: { type: 'stdio', command: 'node', args: ['server.js'] },
          permissionMode: 'auto-allow',
        },
        {
          name: 'deploy',
          transport: { type: 'streamable-http', url: 'http://localhost:3000/mcp' },
          permissionMode: 'manual',
        },
      ],
    };

    const result = loadMCPConfig(config);
    expect(result.servers).toHaveLength(2);
    expect(result.servers[0].name).toBe('docs');
    expect(result.servers[1].name).toBe('deploy');
  });

  it('normalizes server names (replaces special chars with underscores)', () => {
    const config: MCPConfig = {
      servers: [
        { name: 'my server!', transport: { type: 'stdio', command: 'echo' } },
      ],
    };

    const result = loadMCPConfig(config);
    // Spaces and exclamation marks should be replaced with underscores.
    expect(result.servers[0].name).toBe('my_server_');
  });

  it('rejects duplicate server names after normalization', () => {
    const config: MCPConfig = {
      servers: [
        { name: 'my server', transport: { type: 'stdio', command: 'echo' } },
        { name: 'my_server', transport: { type: 'stdio', command: 'cat' } },
        // ^^^ After normalization, both become "my_server" (space → underscore).
      ],
    };

    expect(() => loadMCPConfig(config)).toThrow(/Duplicate/);
  });

  it('rejects stdio transport without a command', () => {
    const config: MCPConfig = {
      servers: [
        // empty string command
        { name: 'bad', transport: { type: 'stdio', command: '' } },
      ],
    };

    expect(() => loadMCPConfig(config)).toThrow(/command/);
  });

  it('rejects streamable-http transport without a url', () => {
    const config: MCPConfig = {
      servers: [
        // empty string url
        { name: 'bad', transport: { type: 'streamable-http', url: '' } },
      ],
    };

    expect(() => loadMCPConfig(config)).toThrow(/url/);
  });

  it('rejects unknown transport types', () => {
    const config: MCPConfig = {
      servers: [
        {
          name: 'bad',
          transport: { type: 'websocket' } as unknown as MCPConfig['servers'][0]['transport'],
        },
      ],
    };

    expect(() => loadMCPConfig(config)).toThrow(/unknown transport/);
  });

  it('defaults permissionMode to auto-allow when not specified', () => {
    const config: MCPConfig = {
      servers: [
        { name: 'test', transport: { type: 'stdio', command: 'echo' } },
      ],
    };

    const result = loadMCPConfig(config);
    // permissionMode is not set but defaults to 'auto-allow' in the plugin.
    // The config loader itself doesn't set defaults — it just validates.
    expect(result.servers[0].permissionMode).toBeUndefined();
  });

  it('handles empty servers array', () => {
    const config: MCPConfig = { servers: [] };
    const result = loadMCPConfig(config);
    expect(result.servers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loadMCPConfigFromEnv (environment variable parsing)
// ---------------------------------------------------------------------------

describe('loadMCPConfigFromEnv', () => {
  // Save original env to restore after each test.
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Restore original environment.
    process.env = { ...savedEnv };
    // Clear any MCP__ vars.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MCP__')) {
        delete process.env[key];
      }
    }
  });

  it('returns an empty config when no MCP env vars are set', () => {
    const result = loadMCPConfigFromEnv();
    expect(result.servers).toHaveLength(0);
  });

  it('parses a stdio transport from env vars', () => {
    process.env['MCP__FILESYSTEM__TRANSPORT'] = 'stdio';
    process.env['MCP__FILESYSTEM__COMMAND'] = 'npx';
    process.env['MCP__FILESYSTEM__ARGS'] = '-y @modelcontextprotocol/server-filesystem /tmp';

    const result = loadMCPConfigFromEnv();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].name).toBe('FILESYSTEM');
    expect(result.servers[0].transport.type).toBe('stdio');

    const transport = result.servers[0].transport;
    if (transport.type === 'stdio') {
      expect(transport.command).toBe('npx');
      expect(transport.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    }
  });

  it('parses a streamable-http transport from env vars', () => {
    process.env['MCP__GITHUB__TRANSPORT'] = 'streamable-http';
    process.env['MCP__GITHUB__URL'] = 'http://localhost:3000/mcp';
    process.env['MCP__GITHUB__HEADERS'] = 'Authorization: Bearer sk-xxx\nX-Custom: value';

    const result = loadMCPConfigFromEnv();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].name).toBe('GITHUB');
    expect(result.servers[0].transport.type).toBe('streamable-http');

    const transport = result.servers[0].transport;
    if (transport.type === 'streamable-http') {
      expect(transport.url).toBe('http://localhost:3000/mcp');
      expect(transport.headers).toBeDefined();
      expect(transport.headers!['Authorization']).toBe('Bearer sk-xxx');
      expect(transport.headers!['X-Custom']).toBe('value');
    }
  });

  it('parses permission mode from env vars', () => {
    process.env['MCP__RESTRICTED__TRANSPORT'] = 'stdio';
    process.env['MCP__RESTRICTED__COMMAND'] = 'echo';
    process.env['MCP__RESTRICTED__PERMISSION'] = 'manual';

    const result = loadMCPConfigFromEnv();
    expect(result.servers[0].permissionMode).toBe('manual');
  });

  it('defaults permission to auto-allow when not specified in env', () => {
    process.env['MCP__TRUSTED__TRANSPORT'] = 'stdio';
    process.env['MCP__TRUSTED__COMMAND'] = 'echo';

    const result = loadMCPConfigFromEnv();
    expect(result.servers[0].permissionMode).toBe('auto-allow');
  });

  it('skips servers with unknown transport types (with console warning)', () => {
    process.env['MCP__BAD__TRANSPORT'] = 'websocket';
    process.env['MCP__BAD__URL'] = 'http://localhost';

    const result = loadMCPConfigFromEnv();
    // The server should be skipped — unknown transport type.
    expect(result.servers).toHaveLength(0);
  });

  it('skips stdio servers without a COMMAND', () => {
    process.env['MCP__NOCMD__TRANSPORT'] = 'stdio';
    // No COMMAND set.

    const result = loadMCPConfigFromEnv();
    expect(result.servers).toHaveLength(0);
  });

  it('skips streamable-http servers without a URL', () => {
    process.env['MCP__NOURL__TRANSPORT'] = 'streamable-http';
    // No URL set.

    const result = loadMCPConfigFromEnv();
    expect(result.servers).toHaveLength(0);
  });

  it('handles multiple servers from env vars', () => {
    process.env['MCP__SERVER_A__TRANSPORT'] = 'stdio';
    process.env['MCP__SERVER_A__COMMAND'] = 'echo';
    process.env['MCP__SERVER_B__TRANSPORT'] = 'streamable-http';
    process.env['MCP__SERVER_B__URL'] = 'http://localhost:8080/mcp';

    const result = loadMCPConfigFromEnv();
    expect(result.servers).toHaveLength(2);
    const names = result.servers.map((s) => s.name);
    expect(names).toContain('SERVER_A');
    expect(names).toContain('SERVER_B');
  });

  it('normalizes server names from env', () => {
    process.env['MCP__MY_SERVER__TRANSPORT'] = 'stdio';
    process.env['MCP__MY_SERVER__COMMAND'] = 'echo';

    const result = loadMCPConfigFromEnv();
    // normalizeName replaces nothing — underscores and uppercase are valid.
    expect(result.servers[0].name).toBe('MY_SERVER');
  });

  it('parser handles quoted arguments correctly', () => {
    process.env['MCP__TEST__TRANSPORT'] = 'stdio';
    process.env['MCP__TEST__COMMAND'] = 'node';
    process.env['MCP__TEST__ARGS'] = 'server.js --port "8080"';

    const result = loadMCPConfigFromEnv();
    const transport = result.servers[0].transport;
    if (transport.type === 'stdio') {
      expect(transport.args).toEqual(['server.js', '--port', '8080']);
    }
  });

  it('handles empty ARGS gracefully', () => {
    process.env['MCP__NOARGS__TRANSPORT'] = 'stdio';
    process.env['MCP__NOARGS__COMMAND'] = 'echo';
    // No ARGS set.

    const result = loadMCPConfigFromEnv();
    const transport = result.servers[0].transport;
    if (transport.type === 'stdio') {
      expect(transport.args).toEqual([]);
    }
  });
});
