import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Agent, MarkdownMemory, createMemoryTools, AllowAllResolver, PermissionManager } from '../../src/index.js';
import { glmClient, MODEL, runIntegration } from './helpers.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mochikit-mem-int-'));
});

describe.skipIf(!runIntegration)('Memory + GLM (integration)', () => {
  it('writes a fact then recalls it across runs', async () => {
    const memory = new MarkdownMemory({ dir });
    const writeAgent = new Agent({
      name: 'writer',
      llm: glmClient(),
      model: MODEL,
      systemPrompt:
        'You persist important facts to memory. When told a preference, call memory_write with type "user".',
      tools: createMemoryTools(memory),
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 4,
      maxTokens: 1024,
    });
    await writeAgent.run('Please remember that my favorite programming language is Rust.');

    const entries = await memory.list();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const bodies = entries.map((e) => `${e.name} ${e.description} ${e.body}`).join(' ').toLowerCase();
    expect(bodies).toContain('rust');

    const readAgent = new Agent({
      name: 'reader',
      llm: glmClient(),
      model: MODEL,
      systemPrompt: 'Answer using memory_read to recall facts when relevant.',
      tools: createMemoryTools(memory),
      permission: new PermissionManager({ resolver: new AllowAllResolver() }),
      maxTurns: 4,
      maxTokens: 1024,
    });
    const out = await readAgent.run('What is my favorite programming language? Use memory_read to check.');
    expect(out.toLowerCase()).toContain('rust');
  }, 180_000);
});
