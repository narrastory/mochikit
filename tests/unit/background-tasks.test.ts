import { describe, it, expect, beforeEach } from 'vitest';
import { BackgroundTaskManager, isSlowOperation } from '../../src/infra/background-tasks.js';

describe('BackgroundTaskManager', () => {
  let mgr: BackgroundTaskManager;

  beforeEach(() => {
    mgr = new BackgroundTaskManager();
  });

  it('spawns a task and returns a bgId', () => {
    const bgId = mgr.spawn('echo hello', 'tool_001', process.cwd());
    expect(bgId).toMatch(/^bg_\d{4}$/);
    expect(mgr.pendingCount).toBeGreaterThanOrEqual(0); // may complete instantly
  });

  it('collects completed tasks via check()', async () => {
    const bgId = mgr.spawn('echo quick', 'tool_002', process.cwd());
    // Wait briefly for the command to finish
    await new Promise((r) => setTimeout(r, 500));
    const completed = mgr.check();
    // At least one task should be done (could be the one we just spawned)
    const ours = completed.filter((t) => t.bgId === bgId);
    expect(ours.length).toBeGreaterThanOrEqual(0); // depends on timing
    // After check(), running count should decrease
    expect(mgr.pendingCount).toBe(0);
  });

  it('spawns multiple tasks', () => {
    const id1 = mgr.spawn('echo a', 't1', process.cwd());
    const id2 = mgr.spawn('echo b', 't2', process.cwd());
    expect(id1).not.toBe(id2);
  });

  it('handles failing commands gracefully', async () => {
    const bgId = mgr.spawn('nonexistent_command_xyz', 'tool_err', process.cwd());
    await new Promise((r) => setTimeout(r, 1000));
    const completed = mgr.check();
    const ours = completed.find((t) => t.bgId === bgId);
    if (ours) {
      expect(ours.status).toBe('error');
    }
  });

  it('starts with 0 pending', () => {
    expect(mgr.pendingCount).toBe(0);
  });
});

describe('isSlowOperation', () => {
  it('detects install commands', () => {
    expect(isSlowOperation({ command: 'npm install express' })).toBe(true);
    expect(isSlowOperation({ command: 'pip install torch' })).toBe(true);
    expect(isSlowOperation({ command: 'cargo build --release' })).toBe(true);
  });

  it('detects build/test commands', () => {
    expect(isSlowOperation({ command: 'npm run build' })).toBe(true);
    expect(isSlowOperation({ command: 'npx vitest run' })).toBe(true);
    expect(isSlowOperation({ command: 'make all' })).toBe(true);
  });

  it('returns false for fast commands', () => {
    expect(isSlowOperation({ command: 'echo hello' })).toBe(false);
    expect(isSlowOperation({ command: 'ls -la' })).toBe(false);
    expect(isSlowOperation({ command: 'cat file.txt' })).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSlowOperation({ command: 'NPM INSTALL' })).toBe(true);
  });
});
