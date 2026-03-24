/**
 * Model registry — resolve registered models to adapters.
 */

import type { ModelAdapter } from './adapter.js';
import type { ModelEntry, ModelsRegistry } from '../core/project.js';
import { OllamaAdapter } from './ollama.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { GeminiAdapter } from './gemini.js';

/** Environment variable names for API keys by provider. */
const ENV_KEYS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_API_KEY',
};

/**
 * Parse a model name string to extract provider and model.
 * Examples:
 *   "ollama:qwen2.5:7b"  → { provider: "ollama", model: "qwen2.5:7b" }
 *   "claude-opus"         → { provider: "anthropic", model: "claude-sonnet-4-20250514" }
 *   "gpt-4o"              → { provider: "openai", model: "gpt-4o" }
 *   "gemini-pro"          → { provider: "gemini", model: "gemini-2.0-flash" }
 */
export function parseModelName(name: string): { provider: string; model: string } {
  if (name.startsWith('ollama:')) {
    return { provider: 'ollama', model: name.slice('ollama:'.length) };
  }
  if (name.startsWith('claude') || name.startsWith('anthropic')) {
    return { provider: 'anthropic', model: name };
  }
  if (name.startsWith('gpt') || name.startsWith('openai')) {
    return { provider: 'openai', model: name };
  }
  if (name.startsWith('gemini') || name.startsWith('google')) {
    return { provider: 'gemini', model: name };
  }
  // Default: treat as ollama local model
  return { provider: 'ollama', model: name };
}

/**
 * Resolve an API key for a model entry.
 * Priority: explicit api_key > environment variable > null
 */
function resolveApiKey(entry: ModelEntry): string | null {
  // If the entry has a non-redacted key, use it
  if (entry.api_key && !entry.api_key.includes('...')) {
    return entry.api_key;
  }
  // Check environment variable
  const envVar = entry.env_var ?? ENV_KEYS[entry.provider];
  if (envVar && process.env[envVar]) {
    return process.env[envVar]!;
  }
  return null;
}

/**
 * Create a ModelAdapter from a ModelEntry.
 */
export function createAdapter(entry: ModelEntry): ModelAdapter {
  const apiKey = resolveApiKey(entry);

  switch (entry.provider) {
    case 'ollama':
      return new OllamaAdapter(
        entry.name,
        entry.model,
        entry.endpoint ?? 'http://localhost:11434',
      );
    case 'anthropic':
      return new AnthropicAdapter(entry.name, entry.model, apiKey, entry.subscription ?? false);
    case 'openai':
      if (!apiKey) throw new Error(`No API key for ${entry.name}. Set OPENAI_API_KEY or pass --api-key`);
      return new OpenAIAdapter(entry.name, entry.model, apiKey, entry.endpoint);
    case 'gemini':
      if (!apiKey) throw new Error(`No API key for ${entry.name}. Set GOOGLE_API_KEY or pass --api-key`);
      return new GeminiAdapter(entry.name, entry.model, apiKey);
    default:
      throw new Error(`Unknown provider: ${entry.provider}`);
  }
}

/**
 * Find a model entry by name in the registry.
 */
export function findModel(registry: ModelsRegistry, name: string): ModelEntry | undefined {
  return registry.models.find((m) => m.name === name);
}

/**
 * Get an adapter for a named model from the registry.
 */
export function getAdapter(registry: ModelsRegistry, name: string): ModelAdapter {
  const entry = findModel(registry, name);
  if (!entry) {
    throw new Error(`Model '${name}' not found. Run 'bpro model list' to see registered models.`);
  }
  return createAdapter(entry);
}

/**
 * Get the conductor adapter from config + registry.
 */
export function getConductorAdapter(
  conductorName: string | undefined,
  registry: ModelsRegistry,
): ModelAdapter {
  if (!conductorName) {
    throw new Error('No conductor set. Run `bpro config set conductor <model>`');
  }
  return getAdapter(registry, conductorName);
}

/**
 * Rank models by estimated capability (for aiops assignment).
 * Higher = more capable.
 */
export function rankModels(registry: ModelsRegistry): ModelEntry[] {
  const providerRank: Record<string, number> = {
    anthropic: 100,
    openai: 90,
    gemini: 80,
    ollama: 30,
  };

  return [...registry.models].sort((a, b) => {
    const rankA = providerRank[a.provider] ?? 50;
    const rankB = providerRank[b.provider] ?? 50;
    return rankB - rankA;
  });
}
