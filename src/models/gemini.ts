/**
 * Google Gemini adapter.
 * Supports subscription mode (gemini CLI) and API mode.
 */

import { execSync } from 'node:child_process';
import type { ModelAdapter, GenerateOptions } from './adapter.js';
import { parseJsonResponse } from '../utils/json-repair.js';

export class GeminiAdapter implements ModelAdapter {
  name: string;
  provider = 'gemini';
  private model: string;
  private apiKey: string | null;
  private subscription: boolean;
  private defaultTimeout: number;

  constructor(name: string, model: string, apiKey: string | null, subscription = false, timeout = 120) {
    this.name = name;
    this.model = model;
    this.apiKey = apiKey;
    this.subscription = subscription;
    this.defaultTimeout = timeout;
  }

  async checkHealth(): Promise<boolean> {
    if (this.subscription) {
      try {
        execSync('which gemini', { stdio: 'pipe' });
        return true;
      } catch {
        // Gemini CLI may not exist yet — still register
        return true;
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
    const fullPrompt = options?.system
      ? `${options.system}\n\n${prompt}`
      : prompt;

    try {
      const result = execSync(
        `gemini --print --model ${this.model}`,
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
      throw new Error(`Gemini CLI failed: ${msg}`);
    }
  }

  private async generateViaApi(prompt: string, options?: GenerateOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error('No API key. Use subscription mode or set GOOGLE_API_KEY.');
    }

    const timeout = (options?.timeout ?? this.defaultTimeout) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const payload: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
    };
    if (options?.system) {
      payload.systemInstruction = { parts: [{ text: options.system }] };
    }
    if (options?.temperature !== undefined) {
      payload.generationConfig = { temperature: options.temperature };
    }
    if (options?.maxTokens) {
      payload.generationConfig = {
        ...(payload.generationConfig as Record<string, unknown> ?? {}),
        maxOutputTokens: options.maxTokens,
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Gemini API error ${resp.status}: ${text}`);
      }

      const data = await resp.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Gemini API timed out after ${this.defaultTimeout}s`);
      }
      throw err;
    }
  }

  async generateJSON<T = unknown>(prompt: string, options?: GenerateOptions): Promise<T> {
    const raw = await this.generate(prompt, options);
    return parseJsonResponse<T>(raw);
  }
}
