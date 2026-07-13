/**
 * MochiConfig — loads runtime configuration from environment / dotenv.
 *
 * Supports multi-provider configuration via the `{NAME}_API_KEY` naming
 * convention.  See `docs/zh/17-配置与环境变量.md` for full
 * documentation.
 *
 * ## Design
 *
 * Configuration is parsed **once** from process.env (after loading the
 * nearest `.env` file found by walking up the directory tree).  The parsed
 * result is cached so repeated calls to {@link loadConfig} are cheap.
 *
 * The single-arg form of `loadConfig()` is ambiguous: a string like
 * `"deepseek"` could be either a provider name or a path to a `.env` file.
 * We resolve the ambiguity by first checking whether the string looks
 * filesystem-ish (contains `/`, `\`, or ends with `.env`).  If neither
 * matches, it's treated as a provider name.
 *
 * ## Provider discovery
 *
 * Two sources of providers are scanned:
 *
 * 1. **Default provider** — populated from bare env vars: `API_KEY`,
 *    `BASE_URL`, `MODEL`, and `MOCHIKIT_WEB_API_KEY`.  This is the
 *    backward-compatible path used in simple single-model setups.
 *
 * 2. **Named providers** — any env var matching `{PREFIX}_API_KEY` where
 *    the prefix is uppercase and at least 2 characters (excluding the
 *    bare `API_KEY` itself).  The corresponding `{PREFIX}_BASE_URL`,
 *    `{PREFIX}_MODEL`, and `{PREFIX}_WEB_API_KEY` are also read.
 *
 * ## Cache strategy
 *
 * - `cachedParsed` is set on the first call and never refreshed.
 * - Call {@link resetConfigCache} (e.g. in tests) to clear it.
 * - The cache is a **hidden** internal state — callers should not depend
 *   on its lifetime.
 *
 * @module config
 */

import { config as loadDotenv } from 'dotenv';

/**
 * Per-provider configuration.
 *
 * Each provider has its own API key, base URL, model identifier, and
 * optional web-scraping API key (used when the provider offers a
 * separate endpoint for web access).
 */
export interface ProviderConfig {
  /** API key used for LLM calls. */
  apiKey: string;
  /** Base URL of the provider's API endpoint. */
  baseUrl: string;
  /** Model identifier string (e.g. `'glm-4.7'`, `'deepseek-chat'`). */
  model: string;
  /** API key for web-access / scraping endpoints (falls back to `apiKey`). */
  webApiKey: string;
}

/**
 * Top-level runtime configuration object.
 *
 * The flat fields (`baseUrl`, `apiKey`, `model`, `webApiKey`) always
 * reflect the **active** provider (i.e. the one named by
 * {@link defaultProvider}).  This preserves backward compatibility for
 * code that doesn't care about multi-provider setups.
 *
 * The nested `providers` map contains **all** discovered providers so
 * multi-provider systems can switch at runtime.
 */
export interface MochiConfig {
  // Flat fields — reflect the active provider (backward compatible)
  /** Active provider's base URL. */
  baseUrl: string;
  /** Active provider's API key. */
  apiKey: string;
  /** Active provider's model name. */
  model: string;
  /** Active provider's web-scraping API key. */
  webApiKey: string;
  /** Whether `MOCHIKIT_RUN_INTEGRATION=1` is set in the environment. */
  runIntegration: boolean;

  // Multi-provider fields (new)
  /** Which provider's values populate the flat fields. */
  defaultProvider: string;
  /** All discovered providers keyed by lowercase name.  Always includes `"default"`. */
  providers: Record<string, ProviderConfig>;
}

// ---------------------------------------------------------------------------
// Internal cache (single parse, many projections)
// ---------------------------------------------------------------------------

/**
 * Internal parse result cached after the first `.env` load.
 *
 * @internal The cache is hidden — callers get a projected {@link MochiConfig}
 *           so we can change the cache shape without breaking the public API.
 */
interface ParsedConfig {
  providers: Record<string, ProviderConfig>;
  runIntegration: boolean;
}

/** @internal Cache of the one-time parse.  Set on first call, cleared by `resetConfigCache()`. */
let cachedParsed: ParsedConfig | undefined;

// ---------------------------------------------------------------------------
// Provider discovery
// ---------------------------------------------------------------------------

/**
 * Scan `process.env` and extract every configured provider.
 *
 * Algorithm:
 * 1. Build the `"default"` provider from bare env vars.
 * 2. Iterate all env keys looking for `{PREFIX}_API_KEY` (uppercase, 2+ chars).
 * 3. Skip the bare `API_KEY` and any prefix already seen.
 * 4. For each match, read the sibling `_BASE_URL`, `_MODEL`, `_WEB_API_KEY`.
 * 5. Also record the `MOCHIKIT_RUN_INTEGRATION` flag.
 *
 * @returns A {@link ParsedConfig} with all discovered providers.
 *
 * @internal Called once during {@link loadConfig} and cached.
 */
function discoverProviders(): ParsedConfig {
  const providers: Record<string, ProviderConfig> = {};
  const defaultApiKey = process.env.API_KEY ?? '';

  // Default provider — bare env vars (backward compatible)
  providers['default'] = {
    apiKey: defaultApiKey,
    baseUrl: process.env.BASE_URL ?? 'https://open.bigmodel.cn/api/anthropic',
    model: process.env.MODEL ?? 'glm-4.7',
    webApiKey: process.env.MOCHIKIT_WEB_API_KEY ?? defaultApiKey,
  };

  // Named providers — scan for {NAME}_API_KEY (uppercase prefix, 2+ chars)
  const re = /^([A-Z][A-Z0-9]+)_API_KEY$/;
  for (const key of Object.keys(process.env)) {
    const m = key.match(re);
    if (!m) continue;
    const name = m[1].toLowerCase();
    // 'api' is the bare API_KEY itself — skip
    if (name === 'api' || providers[name]) continue;
    const prefix = m[1];
    const apiKey = process.env[key] ?? '';
    if (!apiKey) continue;
    providers[name] = {
      apiKey,
      baseUrl: process.env[`${prefix}_BASE_URL`] ?? '',
      model: process.env[`${prefix}_MODEL`] ?? '',
      webApiKey: process.env[`${prefix}_WEB_API_KEY`] ?? apiKey,
    };
  }

  return {
    providers,
    runIntegration: process.env.MOCHIKIT_RUN_INTEGRATION === '1',
  };
}

// ---------------------------------------------------------------------------
// Disambiguation helper
// ---------------------------------------------------------------------------

/**
 * Return `true` when a string looks like a filesystem path rather than
 * a provider name.
 *
 * Heuristic: contains a forward slash, backslash, or ends with `.env`.
 * This is used to disambiguate the single-arg form of {@link loadConfig}.
 *
 * @param s - The string to test.
 * @returns `true` if `s` appears to be a path.
 */
function isPathLike(s: string): boolean {
  return s.includes('/') || s.includes('\\') || s.endsWith('.env');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load config from `process.env` (after loading `.env` if present).
 *
 * ## One-arg forms
 *
 * - `loadConfig()` — use the default provider, auto-discover `.env`.
 * - `loadConfig("deepseek")` — use the `"deepseek"` provider.
 * - `loadConfig("/path/to/.env")` — load a specific `.env` file.
 *
 * ## Two-arg form
 *
 * - `loadConfig("deepseek", "/path/to/.env")` — specify **both** a
 *   provider name and an explicit `.env` path.
 *
 * ## Disambiguation
 *
 * If only one string argument is given, it is treated as a path when
 * {@link isPathLike} returns `true`; otherwise it is treated as a
 * provider name.
 *
 * ## Caching
 *
 * The `.env` file is loaded and `process.env` is scanned **only once**.
 * Subsequent calls return a projection of the cached parse.  Use
 * {@link resetConfigCache} to force a re-scan (primarily for tests).
 *
 * @param providerOrPath - Provider name (e.g. `'deepseek'`) **or** path to a
 *                         `.env` file for the legacy single-arg form.
 * @param envPath - Explicit `.env` file path.  Use this when you need to
 *                  pass **both** a provider name and a custom path.
 * @returns A {@link MochiConfig} object whose flat fields reflect the
 *          selected provider.
 *
 * @throws {Error} When `providerOrPath` names an unknown provider.
 *
 * @example
 * ```ts
 * // Default provider, auto-discover .env
 * const cfg = loadConfig();
 *
 * // Named provider
 * const deepseekCfg = loadConfig('deepseek');
 *
 * // Explicit .env path
 * const customCfg = loadConfig('/home/user/project/.env.prod');
 *
 * // Named provider + explicit .env
 * const both = loadConfig('openai', '/tmp/test.env');
 * ```
 */
export function loadConfig(providerOrPath?: string, envPath?: string): MochiConfig {
  let explicitPath: string | undefined;
  let providerName = 'default';

  // --- disambiguate first argument ----------------------------------------
  if (typeof providerOrPath === 'string') {
    if (envPath !== undefined) {
      // Two-arg form: loadConfig(provider, path)
      providerName = providerOrPath.toLowerCase();
      explicitPath = envPath;
    } else if (isPathLike(providerOrPath)) {
      // One-arg path form: loadConfig('/path/to/.env')
      explicitPath = providerOrPath;
    } else {
      // One-arg provider form: loadConfig('deepseek')
      providerName = providerOrPath.toLowerCase();
    }
  }

  // --- load .env & discover providers (once) ------------------------------
  if (!cachedParsed) {
    // Build the search list: explicit path first (if given), then CWD and
    // parent directories up to 6 levels.  We short-circuit on the first
    // file that sets `API_KEY` — later candidates are not tried.
    const tried = explicitPath
      ? [explicitPath]
      : [`${process.cwd()}/.env`, ...findEnvUp(process.cwd())];
    for (const p of tried) {
      // override:true so our .env wins over host presets (e.g. Vite sets BASE_URL='/').
      loadDotenv({ path: p, override: true });
      if (process.env.API_KEY) break;
    }
    // Cache the discovered providers so subsequent loadConfig() calls
    // (even with different providerOrPath) don't re-parse the env.
    cachedParsed = discoverProviders();
  }

  // --- resolve requested provider -----------------------------------------
  const selected = cachedParsed.providers[providerName];
  if (!selected) {
    const list = Object.keys(cachedParsed.providers).join(', ');
    throw new Error(
      `Unknown provider "${providerName}". Available providers: ${list}. ` +
        `Set ${providerName.toUpperCase()}_API_KEY, ${providerName.toUpperCase()}_BASE_URL, ` +
        `${providerName.toUpperCase()}_MODEL in your .env file.`,
    );
  }

  // Project the cached parse into the public MochiConfig shape.  Flat fields
  // always reflect the selected provider for backward compatibility.
  return {
    baseUrl: selected.baseUrl,
    apiKey: selected.apiKey,
    model: selected.model,
    webApiKey: selected.webApiKey,
    runIntegration: cachedParsed.runIntegration,
    defaultProvider: providerName,
    providers: cachedParsed.providers,
  };
}

// ---------------------------------------------------------------------------
// Helpers (unchanged from original)
// ---------------------------------------------------------------------------

/**
 * Walk up from `from` looking for a `.env` file (up to 6 levels).
 *
 * Starts at `from` itself, then strips the last path segment repeatedly.
 * Stops when the parent equals the current directory (reached root) or
 * after 6 attempts.
 *
 * @param from - The directory to start walking from (typically `process.cwd()`).
 * @returns An array of candidate `.env` file paths (closest first).
 *
 * @internal Used as part of the `.env` discovery chain in {@link loadConfig}.
 */
function findEnvUp(from: string): string[] {
  const paths: string[] = [];
  let dir = from;
  for (let i = 0; i < 6; i++) {
    paths.push(`${dir}/.env`);
    const parent = dir.replace(/[/\\][^/\\]*$/, '');
    if (parent === dir) break;
    dir = parent;
  }
  return paths;
}

/**
 * Reset the config cache so the next call to {@link loadConfig} re-parses
 * the environment.
 *
 * This is primarily used in tests that modify `process.env` between calls.
 * In production, configuration should not change during the lifetime of
 * a process — there is no reason to call this.
 *
 * @example
 * ```ts
 * // In a test: switch to a different provider mid-test
 * process.env.DEEPSEEK_API_KEY = 'sk-test';
 * resetConfigCache();
 * const cfg = loadConfig('deepseek');
 * ```
 */
export function resetConfigCache(): void {
  cachedParsed = undefined;
}
