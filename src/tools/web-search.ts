/**
 * WebSearch tool — GLM (Zhipu) web_search API: POST /paas/v4/web_search.
 *
 * Calls the Zhipu (BigModel) web search endpoint, which performs a live web
 * search and returns ranked results with titles, snippets, and links. This is
 * a GLM-native capability — it does **not** shell out to a third-party search
 * API or scrape search engine pages.
 *
 * ## Authentication
 * The `apiKey` passed to the constructor is sent as a Bearer token in the
 * `Authorization` header. This is the same API key used for GLM chat completions.
 *
 * ## Search engines
 * Four tiers are available:
 * - `search_std` — standard web search (default)
 * - `search_pro` — enhanced/professional search
 * - `search_pro_sogou` — pro search via Sogou
 * - `search_pro_quark` — pro search via Quark
 *
 * @module
 */

import { BaseTool } from '../core/tool.js';

/** Zhipu BigModel web_search API endpoint. */
const SEARCH_URL = 'https://open.bigmodel.cn/api/paas/v4/web_search';

/**
 * Available search engine backends for the Zhipu web_search API.
 *
 * `search_std` is the default and provides a good balance of speed and coverage.
 * The `search_pro_*` variants typically return higher-quality results but may
 * have higher latency or different rate limits.
 */
export type SearchEngine = 'search_std' | 'search_pro' | 'search_pro_sogou' | 'search_pro_quark';

/**
 * A single web search result as returned by the GLM search API.
 */
export interface SearchResult {
  /** Page title (may be truncated). */
  title: string;
  /** Text snippet / summary of the page content. */
  content: string;
  /** Full URL to the result page. */
  link: string;
  /** Media type or source identifier. */
  media: string;
  /** Publication date string (format varies by source). */
  publish_date: string;
}

/**
 * Searches the web via the Zhipu (GLM) web_search API.
 *
 * This tool wraps the GLM-native web search capability. It is NOT a generic
 * search tool — it requires a valid Zhipu API key and is subject to GLM's
 * rate limits and pricing.
 *
 * ## Result format
 * Results are returned as numbered Markdown-style entries:
 * ```
 * 1. Title
 *    https://link
 *    Content snippet...
 * ```
 *
 * @remarks
 * The search query is truncated to 70 characters to match the API's limit.
 * `search_intent` is hardcoded to `false` to return raw search results rather
 * than an AI-generated answer.
 */
export class WebSearchTool extends BaseTool {
  readonly definition = {
    name: 'web_search',
    description: 'Search the web and return result titles, snippets and links.',
    input_schema: {
      type: 'object',
      properties: {
        /** Search query string. Truncated to 70 characters by the API. */
        search_query: { type: 'string', description: 'max 70 chars' },
        /** Which search engine backend to use. Defaults to the tool-level default. */
        search_engine: {
          type: 'string',
          enum: ['search_std', 'search_pro', 'search_pro_sogou', 'search_pro_quark'],
        },
        /** Number of results to return (1-50). Defaults to 10. */
        count: { type: 'number', description: '1-50, default 10' },
        /** Time-based filter for recency of results. */
        search_recency_filter: {
          type: 'string',
          enum: ['oneDay', 'oneWeek', 'oneMonth', 'oneYear', 'noLimit'],
        },
      },
      required: ['search_query'],
    },
  };

  /**
   * @param apiKey - Zhipu BigModel API key (Bearer token for Authorization header).
   * @param defaultEngine - Default search engine when the caller does not specify one.
   *  Defaults to `'search_std'`.
   * @param fetchImpl - Fetch implementation to use. Defaults to the global `fetch`.
   *  Injectable to support testing and environments without native fetch.
   */
  constructor(
    private apiKey: string,
    private defaultEngine: SearchEngine = 'search_std',
    private fetchImpl: typeof fetch = fetch,
  ) {
    super();
  }

  /**
   * Performs a web search via the Zhipu API and returns formatted results.
   *
   * @param input - Must contain `search_query` (string, max 70 chars). Optionally
   *  `search_engine`, `count` (1-50), and `search_recency_filter`.
   * @param _ctx - The tool context (unused in this tool since the API call is
   *  purely HTTP-based with no filesystem interaction).
   * @returns Numbered results as a Markdown-formatted string, or an error
   *  message from the API.
   */
  async execute(input: Record<string, unknown>): Promise<string> {
    // NOTE: API enforces 70-char limit; truncate client-side to fail fast
    const query = this.requireString(input, 'search_query').slice(0, 70);
    const engine = (this.optionalString(input, 'search_engine') ?? this.defaultEngine) as SearchEngine;
    const body: Record<string, unknown> = {
      search_query: query,
      search_engine: engine,
      // NOTE: search_intent=false returns raw search results instead of an AI summary
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

/**
 * Creates a {@link WebSearchTool} instance with the given API key.
 *
 * @param apiKey - Zhipu BigModel API key (used as Bearer token).
 * @param opts - Optional configuration.
 * @param opts.engine - Default search engine backend (defaults to `'search_std'`).
 * @param opts.fetchImpl - Custom fetch implementation (defaults to global `fetch`).
 * @returns A configured WebSearchTool instance.
 */
export function createWebSearchTool(
  apiKey: string,
  opts?: { engine?: SearchEngine; fetchImpl?: typeof fetch },
): WebSearchTool {
  return new WebSearchTool(apiKey, opts?.engine ?? 'search_std', opts?.fetchImpl ?? fetch);
}
