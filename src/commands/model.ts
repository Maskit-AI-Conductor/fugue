/**
 * bpro model — Model registry management with interactive selection.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { select, input, confirm } from '@inquirer/prompts';
import { requireBproDir, loadModels, saveModelsRaw, type ModelEntry } from '../core/project.js';
import { parseModelName, createAdapter } from '../models/registry.js';
import { printSuccess, printError, printInfo, createSpinner } from '../utils/display.js';

/** Preset models that users can choose from. */
const MODEL_PRESETS = [
  { name: 'Claude Opus (subscription — no API key needed)', value: 'claude-opus', provider: 'anthropic', needsKey: false },
  { name: 'Claude Sonnet (subscription — no API key needed)', value: 'claude-sonnet', provider: 'anthropic', needsKey: false },
  { name: 'Claude Haiku (subscription — no API key needed)', value: 'claude-haiku', provider: 'anthropic', needsKey: false },
  { name: 'Ollama — qwen2.5:7b (local SLM)', value: 'ollama:qwen2.5:7b', provider: 'ollama', needsKey: false },
  { name: 'Ollama — exaone3.5:7.8b (local SLM)', value: 'ollama:exaone3.5:7.8b', provider: 'ollama', needsKey: false },
  { name: 'Ollama — custom model', value: 'ollama:custom', provider: 'ollama', needsKey: false },
  { name: 'GPT-4o (API key required)', value: 'gpt-4o', provider: 'openai', needsKey: true },
  { name: 'GPT-4o-mini (API key required)', value: 'gpt-4o-mini', provider: 'openai', needsKey: true },
  { name: 'Gemini Pro (API key required)', value: 'gemini-pro', provider: 'gemini', needsKey: true },
  { name: 'Gemini Flash (API key required)', value: 'gemini-flash', provider: 'gemini', needsKey: true },
  { name: 'Custom (enter manually)', value: '__custom__', provider: 'custom', needsKey: false },
];

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

        // Ask for API key if needed
        if (preset?.needsKey && !apiKey) {
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

      // For anthropic subscription models, mark as subscription
      if (parsed.provider === 'anthropic' && !apiKey) {
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
