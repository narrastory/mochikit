/**
 * WebReader tool — GLM (Zhipu) reader API: POST /paas/v4/reader.
 * Fetches and parses a URL into Markdown/text.
 */

import { BaseTool } from '../core/tool.js';

const READER_URL = 'https://open.bigmodel.cn/api/paas/v4/reader';

export interface ReaderResult {
  content: string;
  title: string;
  url: string;
  description: string;
}

export class WebReaderTool extends BaseTool {
  readonly definition = {
    name: 'web_reader',
    description: 'Fetch a URL and return its parsed content as Markdown.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        return_format: { type: 'string', enum: ['markdown', 'text'] },
        timeout: { type: 'number', description: 'seconds' },
      },
      required: ['url'],
    },
  };

  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const url = this.requireString(input, 'url');
    const body: Record<string, unknown> = { url };
    const fmt = this.optionalString(input, 'return_format');
    if (fmt) body.return_format = fmt;
    const t = this.optionalNumber(input, 'timeout');
    if (t) body.timeout = t;

    const res = await this.fetchImpl(READER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      reader_result?: { content: string; title: string; url: string; description: string };
      error?: { code: string; message: string };
    };
    if (json.error) return `Error ${json.error.code}: ${json.error.message}`;
    const r = json.reader_result;
    if (!r) return 'Error: empty reader result';
    return `# ${r.title}\nURL: ${r.url}\n\n${r.content}`;
  }
}

export function createWebReaderTool(apiKey: string, fetchImpl?: typeof fetch): WebReaderTool {
  return new WebReaderTool(apiKey, fetchImpl);
}
