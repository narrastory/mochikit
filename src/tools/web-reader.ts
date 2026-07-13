/**
 * WebReader tool — GLM (Zhipu) reader API: POST /paas/v4/reader.
 * Fetches and parses a URL into Markdown/text.
 *
 * Uses the Zhipu (BigModel) reader endpoint to fetch a web page and convert
 * it into structured content. The API handles HTTP fetching, HTML parsing,
 * and content extraction server-side — the agent never downloads raw HTML.
 *
 * ## Authentication
 * Uses the same Zhipu API key as the chat and search endpoints, passed as a
 * Bearer token in the `Authorization` header.
 *
 * ## Output formats
 * - `markdown` — the page converted to Markdown (default)
 * - `text` — plain text extraction
 *
 * @module
 */

import { BaseTool } from '../core/tool.js';

/** Zhipu BigModel reader API endpoint. */
const READER_URL = 'https://open.bigmodel.cn/api/paas/v4/reader';

/**
 * Structured result from the Zhipu reader API after parsing a URL.
 */
export interface ReaderResult {
  /** Parsed page content in markdown or text format. */
  content: string;
  /** Page title extracted from the HTML `<title>` tag. */
  title: string;
  /** The URL that was fetched. */
  url: string;
  /** Meta description extracted from the page. */
  description: string;
}

/**
 * Fetches a URL via the Zhipu reader API and returns its parsed content.
 *
 * This tool delegates all HTTP fetching and HTML parsing to the Zhipu API
 * server-side. The agent receives clean, structured content suitable for
 * immediate consumption — no raw HTML, no need for client-side parsing.
 *
 * ## Use cases
 * - Reading documentation pages referenced in a task
 * - Fetching API reference material during code generation
 * - Retrieving the content of linked resources mentioned in search results
 *
 * @remarks
 * The reader API has its own internal timeout (configurable via the `timeout`
 * parameter in seconds). This is separate from any agent-loop-level timeout.
 * The `fetchImpl` dependency is injectable for testing.
 */
export class WebReaderTool extends BaseTool {
  readonly definition = {
    name: 'web_reader',
    description: 'Fetch a URL and return its parsed content as Markdown.',
    input_schema: {
      type: 'object',
      properties: {
        /** The URL to fetch and parse. Must be a fully-formed HTTP(S) URL. */
        url: { type: 'string' },
        /** Output format. `markdown` (default) or `text`. */
        return_format: { type: 'string', enum: ['markdown', 'text'] },
        /** Server-side timeout in seconds. Omit for the API default. */
        timeout: { type: 'number', description: 'seconds' },
      },
      required: ['url'],
    },
  };

  /**
   * @param apiKey - Zhipu BigModel API key (Bearer token for Authorization header).
   * @param fetchImpl - Fetch implementation to use. Defaults to the global `fetch`.
   *  Injectable to support testing and environments without native fetch.
   */
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {
    super();
  }

  /**
   * Fetches and parses a URL via the Zhipu reader API.
   *
   * @param input - Must contain `url` (string). Optionally `return_format`
   *  (`"markdown"` or `"text"`) and `timeout` (seconds).
   * @param _ctx - The tool context (unused — this tool makes a pure HTTP call).
   * @returns The page content formatted as a Markdown heading + body, or an
   *  error message from the API.
   */
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

/**
 * Creates a {@link WebReaderTool} instance with the given API key.
 *
 * @param apiKey - Zhipu BigModel API key (used as Bearer token).
 * @param fetchImpl - Optional custom fetch implementation. Defaults to global `fetch`.
 * @returns A configured WebReaderTool instance.
 */
export function createWebReaderTool(apiKey: string, fetchImpl?: typeof fetch): WebReaderTool {
  return new WebReaderTool(apiKey, fetchImpl);
}
