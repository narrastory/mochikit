import { describe, it, expect, vi } from 'vitest';
import { WebSearchTool, WebReaderTool } from '../../src/index.js';

function mockFetch(responseBody: unknown) {
  return vi.fn(async () => ({
    json: async () => responseBody,
  })) as unknown as typeof fetch;
}

describe('WebSearchTool', () => {
  it('returns formatted results', async () => {
    const tool = new WebSearchTool('key', 'search_std', mockFetch({
      search_result: [
        { title: 'T1', content: 'C1', link: 'L1', media: 'M', publish_date: '' },
      ],
    }));
    const out = await tool.execute({ search_query: 'hello' });
    expect(out).toContain('T1');
    expect(out).toContain('L1');
  });

  it('surfaces API errors', async () => {
    const tool = new WebSearchTool('key', 'search_std', mockFetch({ error: { code: '1703', message: 'no data' } }));
    const out = await tool.execute({ search_query: 'x' });
    expect(out).toContain('1703');
  });
});

describe('WebReaderTool', () => {
  it('returns parsed content', async () => {
    const tool = new WebReaderTool('key', mockFetch({
      reader_result: { content: 'body text', title: 'Title', url: 'https://x', description: 'desc' },
    }));
    const out = await tool.execute({ url: 'https://x' });
    expect(out).toContain('Title');
    expect(out).toContain('body text');
  });
});
