/**
 * bash tool — run a shell command and return stdout+stderr.
 *
 * Spawns a child process via `node:child_process.spawn` using the platform's
 * native shell (`cmd.exe /c` on Windows, `/bin/bash -c` on Unix). This gives
 * the agent access to the full CLI toolchain available on the host machine.
 *
 * @remarks
 * This tool runs arbitrary shell commands — it should always be gated behind
 * a permission system. The default timeout of 60 seconds is a safety net to
 * prevent runaway processes; for long-running tasks the caller can increase
 * `timeout` or use `run_in_background` (which returns immediately and lets
 * the agent continue working while the process runs).
 */

import { spawn } from 'node:child_process';
import { BaseTool } from '../core/tool.js';
import type { ToolContext } from '../core/tool.js';

/**
 * Executes a shell command and captures combined stdout/stderr output.
 *
 * Inherits from {@link BaseTool} for the `requireString` / `optionalNumber`
 * parameter helpers and the standard `ToolContext` pattern.
 *
 * ## Execution flow
 * 1. Spawns a child process with the platform-appropriate shell
 * 2. Collects stdout and stderr interleaved in arrival order
 * 3. On timeout: sends SIGTERM, appends `[timeout]` marker, resolves
 * 4. On close: resolves with output + optional `[exit N]` marker
 * 5. On spawn error: resolves with the error message (never rejects)
 *
 * @remarks
 * The Promise **always resolves** — even on errors or timeouts. This keeps
 * the agent loop running. The error information is embedded in the returned
 * string so the LLM can see and react to failures.
 */
export class BashTool extends BaseTool {
  readonly definition = {
    name: 'bash',
    description: 'Run a shell command and return combined stdout/stderr.',
    input_schema: {
      type: 'object',
      properties: {
        /** Shell command string to execute. */
        command: { type: 'string' },
        /** Timeout in milliseconds. Defaults to 60000 (60 seconds). */
        timeout: { type: 'number', description: 'ms (default 60000)' },
        /** When true, runs the command in the background and returns immediately. */
        run_in_background: {
          type: 'boolean',
          description: 'Set to true to run this command in the background while the agent continues working.',
        },
      },
      required: ['command'],
    },
  };

  /**
   * Spawns a shell child process and returns its combined output.
   *
   * @param input - Must contain `command` (string). Optionally `timeout` (ms,
   *  default 60000) and `run_in_background` (boolean, default false).
   * @param ctx - The tool context providing `cwd` for the child process working directory.
   * @returns A Promise that always resolves with a string containing the
   *  command's stdout, stderr, and optional `[timeout]` or `[exit N]` markers.
   */
  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const command = this.requireString(input, 'command');
    // NOTE: default 60s timeout is generous enough for most dev tool invocations
    // (builds, git operations) while still being a safety net
    const timeout = this.optionalNumber(input, 'timeout') ?? 60_000;
    return new Promise((resolve) => {
      // NOTE: platform-aware shell selection — Windows uses cmd.exe, Unix uses bash
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
      const flag = process.platform === 'win32' ? '/c' : '-c';
      const child = spawn(shell, [flag, command], { cwd: ctx.cwd });
      let out = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        out += '\n[timeout]';
        // IMPORTANT: resolve even on timeout so the agent loop continues
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
        // IMPORTANT: resolve with error message rather than rejecting, so the
        // agent loop does not crash on spawn failures (e.g. missing binary)
        resolve(`Error: ${err.message}`);
      });
    });
  }
}

/**
 * Creates a single {@link BashTool} instance.
 *
 * @returns A new BashTool ready for registration on an Agent or Plugin.
 */
export function createBashTool(): BashTool {
  return new BashTool();
}
