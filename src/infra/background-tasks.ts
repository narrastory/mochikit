/**
 * BackgroundTaskManager — spawn long-running commands so the agent can keep
 * working instead of blocking (tutorial s13).
 *
 * When the model sets `run_in_background: true` on a bash call, the command
 * runs in a detached child process. A placeholder result is returned immediately
 * so the tool-use protocol is satisfied. When the background task finishes, its
 * output is collected and injected as a notification on the next turn.
 */

import { spawn } from 'node:child_process';

export interface BackgroundTask {
  bgId: string;
  toolUseId: string;
  command: string;
  status: 'running' | 'done' | 'error';
  output: string;
  startTime: number;
}

let bgCounter = 0;

export class BackgroundTaskManager {
  private running = new Map<string, BackgroundTask>();
  private completed: BackgroundTask[] = [];

  /**
   * Start a command in the background. Returns the background task ID.
   * A placeholder result should be returned to the model for this turn.
   */
  spawn(command: string, toolUseId: string, cwd: string): string {
    bgCounter += 1;
    const bgId = `bg_${String(bgCounter).padStart(4, '0')}`;
    const task: BackgroundTask = {
      bgId,
      toolUseId,
      command,
      status: 'running',
      output: '',
      startTime: Date.now(),
    };
    this.running.set(bgId, task);

    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
    const flag = process.platform === 'win32' ? '/c' : '-c';
    const child = spawn(shell, [flag, command], { cwd, detached: true, stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (code) => {
      if (code) out += `\n[exit ${code}]`;
      task.output = out;
      task.status = code === 0 ? 'done' : 'error';
      // Move from running to completed.
      this.running.delete(bgId);
      this.completed.push(task);
    });
    child.on('error', (err) => {
      task.output = `Error: ${err.message}`;
      task.status = 'error';
      this.running.delete(bgId);
      this.completed.push(task);
    });
    // Don't wait for the child — unref so it doesn't keep the process alive.
    child.unref();

    return bgId;
  }

  /** Collect completed background tasks since the last check. */
  check(): BackgroundTask[] {
    const ready = this.completed.splice(0);
    return ready;
  }

  /** How many tasks are still running? */
  get pendingCount(): number {
    return this.running.size;
  }
}

/** Heuristic: should this command be run in the background? */
export function isSlowOperation(toolInput: Record<string, unknown>): boolean {
  const cmd = String(toolInput.command ?? '').toLowerCase();
  const keywords = [
    'install', 'build', 'test', 'deploy', 'compile',
    'docker build', 'pip install', 'npm install',
    'cargo build', 'pytest', 'make',
  ];
  return keywords.some((kw) => cmd.includes(kw));
}
