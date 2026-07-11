/**
 * WebSearch tool — GLM (Zhipu) web_search API: POST /paas/v4/web_search.
 */

import { BaseTool } from '../core/tool.js';

const SEARCH_URL = 'https://open.bigmodel.cn/api/paas/v4/web_search';

export type SearchEngine = 'search_std' | 'search_pro' | 'search_pro_sogou' | 'search_pro_quark';

export interface SearchResult {
  title: string;
  content: string;
  link: string;
  media: string;
  publish_date: string;
}

export class WebSearchTool extends BaseTool {
  readonly definition = {
    name: 'web_search',
    description: 'Search the web and return result titles, snippets and links.',
    input_schema: {
      type: 'object',
      properties: {
        search_query: { type: 'string', description: 'max 70 chars' },
        search_engine: {
          type: 'string',
          enum: ['search_std', 'search_pro', 'search_pro_sogou', 'search_pro_quark'],
        },
        count: { type: 'number', description: '1-50, default 10' },
        search_recency_filter: {
          type: 'string',
          enum: ['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit'],
        },
      },
      required: ['search_query'],
    },
  };

  constructor(
    private apiKey: string,
    private defaultEngine: SearchEngine = 'search_std',
    private fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = this.requireString(input, 'search_query').slice(0, 70);
    const engine = (this.optionalString(input, 'search_engine') ?? this.defaultEngine) as SearchEngine;
    const body: Record<string, unknown> = {
      search_query: query,
      search_engine: engine,
      search_intent: false,
    };
    const count = this.optionalNumber(input, 'count');
    if (count) body.count = count;
    const recency = this.optionalString(input, 'search_recency_filter');
    if (recency) body.search_recency_filter = recency;

    const res = await this.fetchImpl(SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      search_result?: SearchResult[];
      error?: { code: string; message: string };
    };
    if (json.error) return `Error ${json.error.code}: ${json.error.message}`;
    const results = json.search_result ?? [];
    if (results.length === 0) return 'No results.';
    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.content}`)
      .join('\n\n');
  }
}

export function createWebSearchTool(
  apiKey: string,
  opts?: { engine?: SearchEngine; fetchImpl?: typeof fetch },
): WebSearchTool {
  return new WebSearchTool(apiKey, opts?.engine ?? 'search_std', opts?.fetchImpl ?? fetch);
}
