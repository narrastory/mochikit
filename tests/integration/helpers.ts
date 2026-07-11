import { loadConfig, AnthropicAdapter, type LLMClient } from '../../src/index.js';

/** Build the real GLM-backed LLM client from .env. */
export function glmClient(): LLMClient {
  const cfg = loadConfig();
  return new AnthropicAdapter({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
}

export const MODEL = loadConfig().model;
export const runIntegration = loadConfig().runIntegration;
