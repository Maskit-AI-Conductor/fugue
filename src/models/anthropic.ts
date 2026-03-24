/**
 * Anthropic (Claude) adapter.
 * Supports two modes:
 * 1. Subscription: uses `claude` CLI (no API key needed)
 * 2. API: direct Anthropic API calls (API key required)
 */

import { execSync } from 'node:child_process';
import type { ModelAdapter, GenerateOptions } from './adapter.js';
import { parseJsonResponse } from '../utils/json-repair.js';

/** Map friendly names to actual model IDs */
const MODEL_MAP: Record<string, string> = {
  'claude-opus': 'claude-opus-4-6',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-haiku': 'claude-haiku-4-5-20251001',
};

export class AnthropicAdapter implements ModelAdapter {
  name: string;
  provider = 'anthropic';
  private model: string;
  private apiKey: string | null;
  private subscription: boolean;
  private defaultTimeout: number;

  constructor(name: string, model: string, apiKey: string | null, subscription = false, timeout = 120) {
    this.name = name;
    this.model = MODEL_MAP[model] ?? model;
    this.apiKey = apiKey;
    this.subscription = subscription;
    this.defaultTimeout = timeout;
  }

  async checkHealth(): Promise<boolean> {
    if (this.subscription) {
      // Check if claude CLI is available
      try {
        execSync('which claude', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
    return Boolean(this.apiKey);
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    if (this.subscription) {
      return this.generateViaCli(prompt, options);
    }
    return this.generateViaApi(prompt, options);
  }

  private generateViaCli(prompt: string, options?: GenerateOptions): string {
    const systemArg = options?.system ? `--system-prompt "${options.system.replace(/"/g, '\\"')}"` : '';
    const modelArg = `--model ${this.model}`;

    // Use claude CLI with --print flag for non-interactive output
    const fullPrompt = options?.system
      ? `${options.system}\n\n${prompt}`
      : prompt;

    try {
      const result = execSync(
        `claude --print ${modelArg} --max-tokens ${options?.maxTokens ?? 4096}`,
        {
          input: fullPrompt,
          encoding: 'utf-8',
          timeout: (options?.timeout ?? this.defaultTimeout) * 1000,
          maxBuffer: 10 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      return result.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude CLI failed: ${msg}`);
    }
  }

  private async generateViaApi(prompt: string, options?: GenerateOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('No API key. Use subscription mode or set ANTHROPIC_API_KEY.');
    }

    const timeout = (options?.timeout ?? this.defaultTimeout) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const payload: Record<string, unknown> = {
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: [{ role: 'user', content: prompt }],
    };
    if (options?.system) payload.system = options.system;
    if (options?.temperature !== undefined) payload.temperature = options.temperature;

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Anthropic API error ${resp.status}: ${text}`);
      }

      const data = await resp.json() as { content?: Array<{ type: string; text?: string }> };
      const textBlock = data.content?.find(b => b.type === 'text');
      return textBlock?.text ?? '';
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Anthropic API timed out after ${this.defaultTimeout}s`);
      }
      throw err;
    }
  }

  async generateJSON<T = unknown>(prompt: string, options?: GenerateOptions): Promise<T> {
    const raw = await this.generate(prompt, options);
    return parseJsonResponse<T>(raw);
  }
}
