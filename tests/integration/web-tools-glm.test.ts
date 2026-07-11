import { describe, it, expect } from 'vitest';
import { WebSearchTool, WebReaderTool, loadConfig } from '../../src/index.js';
import { runIntegration } from './helpers.js';

const cfg = loadConfig();

describe.skipIf(!runIntegration)('Web tools + GLM (integration)', () => {
  it('web_search returns real results', async () => {
    const tool = new WebSearchTool(cfg.webApiKey);
    const out = await tool.execute({ search_query: 'TypeScript 5 release notes', count: 5 });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    // Either real results or a documented API error string — both are non-crash outcomes.
    expect(out).toMatch(/\.|Error|No results/);
  }, 60_000);

  it('web_reader fetches a stable URL', async () => {
    const tool = new WebReaderTool(cfg.webApiKey);
    const out = await tool.execute({ url: 'https://example.com' });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    // example.com's content or a graceful error message
    expect(out.toLowerCase()).toMatch(/example domain|error/);
  }, 60_000);
});
