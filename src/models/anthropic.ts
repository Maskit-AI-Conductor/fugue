/**
 * Anthropic (Claude) adapter.
 * Supports two modes:
 * 1. Subscription: uses `claude` CLI (no API key needed)
 * 2. API: direct Anthropic API calls (API key required)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelAdapter, GenerateOptions, GenerateResult } from './adapter.js';
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

    // Write prompt to temp file to avoid stdin pipe issues with large prompts
    const tmpFile = path.join(os.tmpdir(), `bpro-prompt-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, fullPrompt, 'utf-8');

    try {
      const result = execSync(
        `cat "${tmpFile}" | claude --print --model ${this.model}`,
        {
          encoding: 'utf-8',
          timeout: (options?.timeout ?? this.defaultTimeout) * 1000,
          maxBuffer: 50 * 1024 * 1024,
          shell: '/bin/bash',
        },
      );
      return result.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude CLI failed: ${msg}`);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  private async generateViaApi(prompt: string, options?: GenerateOptions): Promise<string> {
    const result = await this.generateViaApiWithUsage(prompt, options);
    return result.text;
  }

  private async generateViaApiWithUsage(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
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

      const data = await resp.json() as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const textBlock = data.content?.find(b => b.type === 'text');
      return {
        text: textBlock?.text ?? '',
        tokens_in: data.usage?.input_tokens,
        tokens_out: data.usage?.output_tokens,
      };
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
