/**
 * MochiConfig — loads runtime configuration from environment / dotenv.
 */

import { config as loadDotenv } from 'dotenv';

export interface MochiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  webApiKey: string;
  runIntegration: boolean;
}

let cached: MochiConfig | undefined;

/** Load config from process.env (after loading .env if present). */
export function loadConfig(envPath?: string): MochiConfig {
  if (cached) return cached;
  // Try the explicit path, then .env in cwd, then walk up to find a .env.
  const tried = envPath ? [envPath] : [`${process.cwd()}/.env`, ...findEnvUp(process.cwd())];
  for (const p of tried) {
    // override:true so our .env wins over host presets (e.g. Vite sets BASE_URL='/').
    loadDotenv({ path: p, override: true });
    if (process.env.API_KEY) break;
  }
  const apiKey = process.env.API_KEY ?? '';
  cached = {
    baseUrl: process.env.BASE_URL ?? 'https://open.bigmodel.cn/api/anthropic',
    apiKey,
    model: process.env.MODEL ?? 'glm-4.7',
    webApiKey: process.env.MOCHIKIT_WEB_API_KEY ?? apiKey,
    runIntegration: process.env.MOCHIKIT_RUN_INTEGRATION === '1',
  };
  return cached;
}

/** Walk up from `from` looking for a `.env` file (up to 6 levels). */
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

/** Reset the cache (for tests). */
export function resetConfigCache(): void {
  cached = undefined;
}
