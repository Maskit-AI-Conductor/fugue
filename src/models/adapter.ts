/**
 * ModelAdapter — common interface for all LLM/SLM providers.
 */

export interface GenerateOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  timeout?: number;
}

/** Result of a generate call, including token usage. */
export interface GenerateResult {
  text: string;
  tokens_in?: number;
  tokens_out?: number;
}

export interface ModelAdapter {
  /** Display name (e.g. "ollama:qwen2.5:7b") */
  name: string;

  /** Provider type */
  provider: string;

  /** Generate text response */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;

  /** Generate text response with token usage info */
  generateWithUsage(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;

  /** Generate and parse JSON response */
  generateJSON<T = unknown>(prompt: string, options?: GenerateOptions): Promise<T>;

  /** Health check — is the model reachable? */
  checkHealth(): Promise<boolean>;
}
