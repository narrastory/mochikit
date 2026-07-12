/**
 * bash tool — run a shell command and return stdout+stderr.
 */

import { spawn } from 'node:child_process';
import { BaseTool } from '../core/tool.js';
import type { ToolContext } from '../core/tool.js';

export class BashTool extends BaseTool {
  readonly definition = {
    name: 'bash',
    description: 'Run a shell command and return combined stdout/stderr.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout: { type: 'number', description: 'ms (default 60000)' },
        run_in_background: {
          type: 'boolean',
          description: 'Set to true to run this command in the background while the agent continues working.',
        },
      },
      required: ['command'],
    },
  };

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const command = this.requireString(input, 'command');
    const timeout = this.optionalNumber(input, 'timeout') ?? 60_000;
    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
      const flag = process.platform === 'win32' ? '/c' : '-c';
      const child = spawn(shell, [flag, command], { cwd: ctx.cwd });
      let out = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        out += '\n[timeout]';
        resolve(out);
      }, timeout);
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (out += d.toString()));
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(out + (code ? `\n[exit ${code}]` : ''));
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve(`Error: ${err.message}`);
      });
    });
  }
}

export function createBashTool(): BashTool {
  return new BashTool();
}
