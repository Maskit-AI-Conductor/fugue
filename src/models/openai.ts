/**
 * OpenAI (GPT / Codex) adapter.
 * Supports subscription mode (codex CLI) and API mode.
 */

import { execSync } from 'node:child_process';
import type { ModelAdapter, GenerateOptions, GenerateResult } from './adapter.js';
import { parseJsonResponse } from '../utils/json-repair.js';

export class OpenAIAdapter implements ModelAdapter {
  name: string;
  provider = 'openai';
  private model: string;
  private apiKey: string | null;
  private subscription: boolean;
  private endpoint: string;
  private defaultTimeout: number;

  constructor(
    name: string,
    model: string,
    apiKey: string | null,
    subscription = false,
    endpoint = 'https://api.openai.com/v1',
    timeout = 120,
  ) {
    this.name = name;
    this.model = model;
    this.apiKey = apiKey;
    this.subscription = subscription;
    this.endpoint = endpoint.replace(/\/$/, '');
    this.defaultTimeout = timeout;
  }

  async checkHealth(): Promise<boolean> {
    if (this.subscription) {
      try {
        execSync('which codex', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
    return Boolean(this.apiKey);
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const result = await this.generateWithUsage(prompt, options);
    return result.text;
  }

  async generateWithUsage(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (this.subscription) {
      return this.generateViaCliWithUsage(prompt, options);
    }
    return this.generateViaApiWithUsage(prompt, options);
  }

  private generateViaCliWithUsage(prompt: string, options?: GenerateOptions): GenerateResult {
    const text = this.generateViaCli(prompt, options);
    // CLI subscription: estimate tokens from text length (~4 chars per token)
    const tokens_in = Math.ceil(prompt.length / 4);
    const tokens_out = Math.ceil(text.length / 4);
    return { text, tokens_in, tokens_out };
  }

  private generateViaCli(prompt: string, options?: GenerateOptions): string {
    const fullPrompt = options?.system
      ? `${options.system}\n\n${prompt}`
      : prompt;

    try {
      const result = execSync(
        `codex --print --model ${this.model}`,
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
      throw new Error(`Codex CLI failed: ${msg}`);
    }
  }

  private async generateViaApi(prompt: string, options?: GenerateOptions): Promise<string> {
    const result = await this.generateViaApiWithUsage(prompt, options);
    return result.text;
  }

  private async generateViaApiWithUsage(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (!this.apiKey) {
      throw new Error('No API key. Use subscription mode or set OPENAI_API_KEY.');
    }

    const timeout = (options?.timeout ?? this.defaultTimeout) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const messages: Array<{ role: string; content: string }> = [];
    if (options?.system) {
      messages.push({ role: 'system', content: options.system });
    }
    messages.push({ role: 'user', content: prompt });

    const payload: Record<string, unknown> = {
      model: this.model,
      messages,
    };
    if (options?.maxTokens) payload.max_tokens = options.maxTokens;
    if (options?.temperature !== undefined) payload.temperature = options.temperature;
    if (options?.jsonMode) payload.response_format = { type: 'json_object' };

    try {
      const resp = await fetch(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`OpenAI API error ${resp.status}: ${text}`);
      }

      const data = await resp.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        tokens_in: data.usage?.prompt_tokens,
        tokens_out: data.usage?.completion_tokens,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`OpenAI API timed out after ${this.defaultTimeout}s`);
      }
      throw err;
    }
  }

  async generateJSON<T = unknown>(prompt: string, options?: GenerateOptions): Promise<T> {
    const raw = await this.generate(prompt, { ...options, jsonMode: !this.subscription });
    return parseJsonResponse<T>(raw);
  }
}
