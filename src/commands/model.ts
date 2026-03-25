/**
 * bpro model — Model registry management with interactive selection.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { select, input, confirm } from '@inquirer/prompts';
import { requireBproDir, loadModels, saveModelsRaw, type ModelEntry } from '../core/project.js';
import { parseModelName, createAdapter } from '../models/registry.js';
import { printSuccess, printError, printInfo, createSpinner } from '../utils/display.js';
import type { AgentLog } from '../agents/runner.js';

/** Preset models that users can choose from. */
const MODEL_PRESETS = [
  // Claude
  { name: 'Claude Opus', value: 'claude-opus', provider: 'anthropic', hasSub: true, hasApi: true },
  { name: 'Claude Sonnet', value: 'claude-sonnet', provider: 'anthropic', hasSub: true, hasApi: true },
  { name: 'Claude Haiku', value: 'claude-haiku', provider: 'anthropic', hasSub: true, hasApi: true },
  // Ollama (local only)
  { name: 'Ollama — qwen2.5:7b', value: 'ollama:qwen2.5:7b', provider: 'ollama', hasSub: false, hasApi: false },
  { name: 'Ollama — exaone3.5:7.8b', value: 'ollama:exaone3.5:7.8b', provider: 'ollama', hasSub: false, hasApi: false },
  { name: 'Ollama — custom model', value: 'ollama:custom', provider: 'ollama', hasSub: false, hasApi: false },
  // OpenAI / Codex
  { name: 'GPT-4o', value: 'gpt-4o', provider: 'openai', hasSub: true, hasApi: true },
  { name: 'GPT-4o-mini', value: 'gpt-4o-mini', provider: 'openai', hasSub: true, hasApi: true },
  { name: 'Codex (OpenAI)', value: 'codex', provider: 'openai', hasSub: true, hasApi: true },
  // Gemini
  { name: 'Gemini Pro', value: 'gemini-pro', provider: 'gemini', hasSub: true, hasApi: true },
  { name: 'Gemini Flash', value: 'gemini-flash', provider: 'gemini', hasSub: true, hasApi: true },
  // Custom
  { name: 'Custom (enter manually)', value: '__custom__', provider: 'custom', hasSub: false, hasApi: false },
];

/** CLI command names for subscription mode by provider. */
const SUBSCRIPTION_CLI: Record<string, string> = {
  anthropic: 'claude',
  openai: 'codex',
  gemini: 'gemini',   // placeholder — may need adjustment
};

export const modelCommand = new Command('model')
  .description('Manage model registry');

// Interactive add (no arguments)
modelCommand
  .command('add [name]')
  .description('Register a model (interactive if no name given)')
  .option('--endpoint <url>', 'API endpoint (for Ollama or custom)')
  .option('--api-key <key>', 'API key')
  .action(async (name?: string, opts?: { endpoint?: string; apiKey?: string }) => {
    try {
      const bproDir = requireBproDir();
      const registry = loadModels(bproDir);

      let modelName = name;
      let endpoint = opts?.endpoint;
      let apiKey = opts?.apiKey;
      let useSubscription = false;

      // Interactive mode if no name given
      if (!modelName) {
        const chosen = await select({
          message: 'Select a model to register:',
          choices: MODEL_PRESETS.map(p => ({
            name: p.name,
            value: p.value,
          })),
        });

        if (chosen === '__custom__') {
          modelName = await input({ message: 'Model name (e.g. ollama:mistral, gpt-4-turbo):' });
        } else if (chosen === 'ollama:custom') {
          const customModel = await input({ message: 'Ollama model name (e.g. llama3, mistral, phi3):' });
          modelName = `ollama:${customModel}`;
        } else {
          modelName = chosen;
        }

        const preset = MODEL_PRESETS.find(p => p.value === chosen);

        // Ask for endpoint if ollama
        if (preset?.provider === 'ollama' && !endpoint) {
          const useDefault = await confirm({
            message: 'Ollama endpoint: http://localhost:11434?',
            default: true,
          });
          if (!useDefault) {
            endpoint = await input({ message: 'Ollama endpoint:' });
          }
        }

        // Ask subscription vs API key for models that support both
        if (preset && preset.hasSub && preset.hasApi) {
          const cliName = SUBSCRIPTION_CLI[preset.provider] ?? preset.provider;
          const authMode = await select({
            message: `How to connect to ${modelName}?`,
            choices: [
              { name: `Subscription (uses ${cliName} CLI — no API key needed)`, value: 'subscription' },
              { name: 'API key (direct API call)', value: 'api' },
            ],
          });
          if (authMode === 'subscription') {
            useSubscription = true;
          } else if (!apiKey) {
            apiKey = await input({ message: `API key for ${modelName}:` });
          }
        } else if (preset && preset.hasApi && !preset.hasSub && !apiKey) {
          // API only
          apiKey = await input({ message: `API key for ${modelName}:` });
        }
      }

      if (!modelName) {
        printError('No model name provided.');
        process.exit(1);
      }

      // Check for duplicate
      if (registry.models.find(m => m.name === modelName)) {
        printError(`Model '${modelName}' already registered. Remove it first: bpro model remove ${modelName}`);
        process.exit(1);
      }

      const parsed = parseModelName(modelName);

      const entry: ModelEntry = {
        name: modelName,
        provider: parsed.provider,
        model: parsed.model,
        added_at: new Date().toISOString(),
      };

      if (endpoint) entry.endpoint = endpoint;
      if (apiKey) entry.api_key = apiKey;

      // For ollama, set default endpoint
      if (parsed.provider === 'ollama' && !entry.endpoint) {
        entry.endpoint = 'http://localhost:11434';
      }

      // Mark subscription mode
      if (useSubscription || (!apiKey && parsed.provider !== 'ollama')) {
        entry.subscription = true;
      }

      // Health check
      const spinner = createSpinner(`Checking ${modelName}...`);
      spinner.start();

      try {
        const adapter = createAdapter(entry);
        const healthy = await adapter.checkHealth();
        if (healthy) {
          spinner.succeed(`${modelName} is reachable`);
        } else {
          spinner.warn(`${modelName} registered but health check failed`);
        }
      } catch {
        // Subscription models always pass health check
        if (entry.subscription) {
          spinner.succeed(`${modelName} registered (subscription mode)`);
        } else {
          spinner.warn(`${modelName} registered but health check failed`);
        }
      }

      registry.models.push(entry);
      saveModelsRaw(bproDir, registry);

      printSuccess(`Model '${modelName}' registered (${parsed.provider})`);

      // Hint if no conductor
      const { loadConfig } = await import('../core/project.js');
      const config = loadConfig(bproDir);
      if (!config.conductor) {
        console.log();
        console.log(`  ${chalk.dim('Next:')} ${chalk.cyan('bpro config set conductor')}`);
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'ExitPromptError') {
        // User cancelled
        return;
      }
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

modelCommand
  .command('list')
  .description('List registered models')
  .action(async () => {
    try {
      const bproDir = requireBproDir();
      const registry = loadModels(bproDir);
      const { loadConfig } = await import('../core/project.js');
      const config = loadConfig(bproDir);

      if (registry.models.length === 0) {
        printInfo('No models registered.');
        console.log(`  ${chalk.cyan('bpro model add')} — register your first model`);
        return;
      }

      console.log();
      console.log(`  ${chalk.bold('Registered Models')}`);
      console.log(`  ${chalk.dim('-'.repeat(60))}`);

      for (const m of registry.models) {
        const isConductor = m.name === config.conductor;
        const badge = isConductor ? chalk.yellow(' [conductor]') : '';
        const sub = m.subscription ? chalk.green(' [subscription]') : '';
        const endpoint = m.endpoint ? chalk.dim(` (${m.endpoint})`) : '';
        const apiKeyHint = m.api_key ? chalk.dim(' [key set]') : '';

        console.log(`  ${chalk.cyan(m.name.padEnd(25))}${chalk.dim(m.provider.padEnd(12))}${m.model}${endpoint}${apiKeyHint}${sub}${badge}`);
      }
      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

modelCommand
  .command('remove <name>')
  .description('Remove a model from registry')
  .action(async (name: string) => {
    try {
      const bproDir = requireBproDir();
      const registry = loadModels(bproDir);

      const idx = registry.models.findIndex(m => m.name === name);
      if (idx === -1) {
        printError(`Model '${name}' not found.`);
        process.exit(1);
      }

      registry.models.splice(idx, 1);
      saveModelsRaw(bproDir, registry);

      printSuccess(`Model '${name}' removed.`);

      const { loadConfig } = await import('../core/project.js');
      const config = loadConfig(bproDir);
      if (config.conductor === name) {
        console.log(`  ${chalk.yellow('WARN')} This was the conductor. Run: ${chalk.cyan('bpro config set conductor')}`);
      }
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

/** Cost per 1K input tokens by provider. */
const COST_PER_1K_INPUT: Record<string, number> = {
  anthropic: 0.015,
  openai: 0.005,
  gemini: 0.00035,
  ollama: 0,
};

/** Cost per 1K output tokens by provider (typically ~3-5x input). */
const COST_PER_1K_OUTPUT: Record<string, number> = {
  anthropic: 0.075,
  openai: 0.015,
  gemini: 0.0014,
  ollama: 0,
};

interface ModelUsageRow {
  model: string;
  provider: string;
  calls: number;
  tokens_in: number;
  tokens_out: number;
}

modelCommand
  .command('usage')
  .description('Show token usage and estimated cost per model')
  .action(async () => {
    try {
      const bproDir = requireBproDir();

      // Read all .jsonl log files
      const logsDir = path.join(bproDir, 'logs');
      if (!fs.existsSync(logsDir)) {
        printInfo('No agent logs found. Run agent tasks first.');
        return;
      }

      const logFiles = fs.readdirSync(logsDir).filter(f => f.endsWith('.jsonl'));
      if (logFiles.length === 0) {
        printInfo('No agent logs found. Run agent tasks first.');
        return;
      }

      const usageMap = new Map<string, ModelUsageRow>();

      for (const file of logFiles) {
        const content = fs.readFileSync(path.join(logsDir, file), 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const log = JSON.parse(line) as AgentLog;
            if (!log.model) continue;

            const existing = usageMap.get(log.model);
            const tokIn = log.tokens_in ?? 0;
            const tokOut = log.tokens_out ?? 0;

            if (existing) {
              existing.calls++;
              existing.tokens_in += tokIn;
              existing.tokens_out += tokOut;
            } else {
              // Determine provider from model name
              const parsed = parseModelName(log.model);
              usageMap.set(log.model, {
                model: log.model,
                provider: parsed.provider,
                calls: 1,
                tokens_in: tokIn,
                tokens_out: tokOut,
              });
            }
          } catch {
            // skip invalid lines
          }
        }
      }

      if (usageMap.size === 0) {
        printInfo('No model usage data found in logs.');
        return;
      }

      const rows = [...usageMap.values()].sort((a, b) => b.tokens_in - a.tokens_in);

      let totalCalls = 0;
      let totalIn = 0;
      let totalOut = 0;
      let totalCost = 0;

      console.log();
      console.log(`  ${chalk.bold('Model Usage')}`);
      console.log(`  ${chalk.dim('\u2500'.repeat(70))}`);
      console.log(
        `  ${chalk.dim(pad('Model', 25))}${chalk.dim(pad('Calls', 8))}${chalk.dim(pad('Tokens In', 12))}${chalk.dim(pad('Tokens Out', 12))}${chalk.dim('Est. Cost')}`,
      );
      console.log(`  ${chalk.dim('\u2500'.repeat(70))}`);

      for (const row of rows) {
        const costIn = (row.tokens_in / 1000) * (COST_PER_1K_INPUT[row.provider] ?? 0);
        const costOut = (row.tokens_out / 1000) * (COST_PER_1K_OUTPUT[row.provider] ?? 0);
        const cost = costIn + costOut;

        totalCalls += row.calls;
        totalIn += row.tokens_in;
        totalOut += row.tokens_out;
        totalCost += cost;

        console.log(
          `  ${chalk.cyan(pad(row.model, 25))}${pad(String(row.calls), 8)}${pad(row.tokens_in.toLocaleString(), 12)}${pad(row.tokens_out.toLocaleString(), 12)}${cost > 0 ? `$${cost.toFixed(2)}` : chalk.dim('$0.00')}`,
        );
      }

      console.log(`  ${chalk.dim('\u2500'.repeat(70))}`);
      console.log(
        `  ${chalk.bold(pad('Total', 25))}${pad(String(totalCalls), 8)}${pad(totalIn.toLocaleString(), 12)}${pad(totalOut.toLocaleString(), 12)}${totalCost > 0 ? chalk.bold(`$${totalCost.toFixed(2)}`) : chalk.dim('$0.00')}`,
      );
      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

function pad(s: string, width: number): string {
  return s.padEnd(width);
}
