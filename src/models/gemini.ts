/**
 * Google Gemini adapter.
 * Supports subscription mode (gemini CLI) and API mode.
 */

import { execSync, exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelAdapter, GenerateOptions, GenerateResult } from './adapter.js';
import { parseJsonResponse } from '../utils/json-repair.js';
import { getShell, createPipeCommand, createTempFilePath } from '../utils/platform.js';

const execAsync = promisify(exec);

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
        const cmd = process.platform === 'win32' ? 'where gemini' : 'which gemini';
        execSync(cmd, { stdio: 'pipe' });
        return true;
      } catch {
        // Gemini CLI may not exist yet — still register
        return true;
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

  private async generateViaCliWithUsage(prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    const text = await this.generateViaCliAsync(prompt, options);
    const tokens_in = Math.ceil(prompt.length / 4);
    const tokens_out = Math.ceil(text.length / 4);
    return { text, tokens_in, tokens_out };
  }

  private async generateViaCliAsync(prompt: string, options?: GenerateOptions): Promise<string> {
    const fullPrompt = options?.system
      ? `${options.system}\n\n${prompt}`
      : prompt;

    const tmpFile = createTempFilePath('fugue-gemini');
    const fs = await import('node:fs');
    fs.writeFileSync(tmpFile, fullPrompt, 'utf-8');

    try {
      const { stdout } = await execAsync(
        createPipeCommand(tmpFile, `gemini --print --model ${this.model}`),
        {
          encoding: 'utf-8',
          timeout: (options?.timeout ?? this.defaultTimeout) * 1000,
          maxBuffer: 50 * 1024 * 1024,
          shell: getShell(),
        },
      );
      return stdout.trim();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Gemini CLI failed: ${msg}`);
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
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      return {
        text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
        tokens_in: data.usageMetadata?.promptTokenCount,
        tokens_out: data.usageMetadata?.candidatesTokenCount,
      };
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
