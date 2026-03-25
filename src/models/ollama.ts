/**
 * Ollama adapter — local SLM via Ollama API.
 */

import type { ModelAdapter, GenerateOptions, GenerateResult } from './adapter.js';
import { parseJsonResponse } from '../utils/json-repair.js';

export class OllamaAdapter implements ModelAdapter {
  name: string;
  provider = 'ollama';
  private endpoint: string;
  private model: string;
  private defaultTimeout: number;

  constructor(name: string, model: string, endpoint = 'http://localhost:11434', timeout = 120) {
    this.name = name;
    this.model = model;
    this.endpoint = endpoint.replace(/\/$/, '');
    this.defaultTimeout = timeout;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(`${this.endpoint}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      return resp.ok;
    } catch {
      return false;
    }
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const result = await this.generateWithUsage(prompt, options);
    return result.text;
  }

  async generateWithUsage(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const timeout = (options?.timeout ?? this.defaultTimeout) * 1000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const payload: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
    };
    if (options?.system) payload.system = options.system;
    if (options?.jsonMode) payload.format = 'json';

    try {
      const resp = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Ollama API error ${resp.status}: ${text}`);
      }

      const data = await resp.json() as {
        response?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        text: data.response ?? '',
        tokens_in: data.prompt_eval_count,
        tokens_out: data.eval_count,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Ollama timed out after ${this.defaultTimeout}s`);
      }
      throw err;
    }
  }

  async generateJSON<T = unknown>(prompt: string, options?: GenerateOptions): Promise<T> {
    const raw = await this.generate(prompt, { ...options, jsonMode: true });
    return parseJsonResponse<T>(raw);
  }
}
