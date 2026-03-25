/**
 * fugue setup — One-shot setup: scan available models, register all, pick conductor.
 * Called automatically after `fugue init`, or standalone via `fugue setup`.
 */

import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { checkbox, select, confirm } from '@inquirer/prompts';
import { loadModels, saveModelsRaw, loadConfig, saveConfig, type ModelEntry } from '../core/project.js';
import { parseModelName, createAdapter } from '../models/registry.js';
import { printSuccess, printError, printInfo, printWarning, createSpinner } from '../utils/display.js';

interface DetectedModel {
  name: string;
  provider: string;
  model: string;
  subscription: boolean;
  endpoint?: string;
  available: boolean;
  detail: string;
}

/** Auto-detect all available models on this machine. */
async function detectModels(): Promise<DetectedModel[]> {
  const detected: DetectedModel[] = [];

  // 1. Claude CLI
  try {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    execSync(cmd, { stdio: 'pipe' });
    detected.push(
      { name: 'claude-opus', provider: 'anthropic', model: 'claude-opus', subscription: true, available: true, detail: 'claude CLI found' },
      { name: 'claude-sonnet', provider: 'anthropic', model: 'claude-sonnet', subscription: true, available: true, detail: 'claude CLI found' },
    );
  } catch { /* not installed */ }

  // 2. Codex CLI
  try {
    const cmd = process.platform === 'win32' ? 'where codex' : 'which codex';
    execSync(cmd, { stdio: 'pipe' });
    detected.push(
      { name: 'codex', provider: 'openai', model: 'codex', subscription: true, available: true, detail: 'codex CLI found' },
    );
  } catch { /* not installed */ }

  // 3. Gemini CLI
  try {
    const cmd = process.platform === 'win32' ? 'where gemini' : 'which gemini';
    execSync(cmd, { stdio: 'pipe' });
    detected.push(
      { name: 'gemini-pro', provider: 'gemini', model: 'gemini-pro', subscription: true, available: true, detail: 'gemini CLI found' },
    );
  } catch { /* not installed */ }

  // 4. Ollama — check running + list models
  try {
    const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = await resp.json() as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      for (const m of models) {
        detected.push({
          name: `ollama:${m.name}`,
          provider: 'ollama',
          model: m.name,
          subscription: false,
          endpoint: 'http://localhost:11434',
          available: true,
          detail: 'Ollama running',
        });
      }
    }
  } catch { /* ollama not running */ }

  // 5. Check environment variables for API keys
  if (process.env.ANTHROPIC_API_KEY && !detected.find(d => d.provider === 'anthropic')) {
    detected.push(
      { name: 'claude-opus', provider: 'anthropic', model: 'claude-opus', subscription: false, available: true, detail: 'ANTHROPIC_API_KEY set' },
      { name: 'claude-sonnet', provider: 'anthropic', model: 'claude-sonnet', subscription: false, available: true, detail: 'ANTHROPIC_API_KEY set' },
    );
  }
  if (process.env.OPENAI_API_KEY && !detected.find(d => d.provider === 'openai')) {
    detected.push(
      { name: 'gpt-4o', provider: 'openai', model: 'gpt-4o', subscription: false, available: true, detail: 'OPENAI_API_KEY set' },
    );
  }
  if (process.env.GOOGLE_API_KEY && !detected.find(d => d.provider === 'gemini')) {
    detected.push(
      { name: 'gemini-pro', provider: 'gemini', model: 'gemini-pro', subscription: false, available: true, detail: 'GOOGLE_API_KEY set' },
    );
  }

  return detected;
}

/**
 * Run the full setup flow: detect → select → register → pick conductor.
 */
export async function runSetup(fugueDir: string): Promise<void> {
  console.log();
  printInfo('Scanning for available models...');

  const spinner = createSpinner('Detecting models...');
  spinner.start();

  const detected = await detectModels();

  if (detected.length === 0) {
    spinner.warn('No models detected');
    console.log();
    printWarning('No models found. You need at least one:');
    console.log(`  ${chalk.cyan('claude')} CLI    — ${chalk.dim('brew install claude-code')}`);
    console.log(`  ${chalk.cyan('ollama')} local  — ${chalk.dim('https://ollama.com')}`);
    console.log(`  ${chalk.cyan('codex')} CLI     — ${chalk.dim('npm install -g @openai/codex')}`);
    console.log();
    console.log(`  Or register manually: ${chalk.cyan('fugue model add')}`);
    return;
  }

  spinner.succeed(`Found ${detected.length} model(s)`);
  console.log();

  // Show detected models and let user select which to register
  const choices = detected.map(d => ({
    name: `${d.name} ${chalk.dim(`(${d.detail})`)}`,
    value: d.name,
    checked: true,  // all checked by default
  }));

  const selected = await checkbox({
    message: 'Select models to register (all detected are pre-selected):',
    choices,
  });

  if (selected.length === 0) {
    printWarning('No models selected. Run `fugue model add` later.');
    return;
  }

  // Register selected models
  const registry = loadModels(fugueDir);

  for (const name of selected) {
    const model = detected.find(d => d.name === name);
    if (!model) continue;
    if (registry.models.find(m => m.name === name)) continue;  // skip duplicates

    const parsed = parseModelName(name);
    const entry: ModelEntry = {
      name,
      provider: parsed.provider,
      model: parsed.model,
      added_at: new Date().toISOString(),
    };
    if (model.endpoint) entry.endpoint = model.endpoint;
    if (model.subscription) entry.subscription = true;

    registry.models.push(entry);
    console.log(`  ${chalk.green('✓')} ${chalk.cyan(name)} registered ${model.subscription ? chalk.green('[subscription]') : ''}`);
  }

  saveModelsRaw(fugueDir, registry);
  console.log();

  // Pick conductor
  if (registry.models.length > 0) {
    const conductorChoice = await select({
      message: 'Select conductor (orchestrator) — the smartest model you have:',
      choices: registry.models.map(m => ({
        name: `${m.name} (${m.provider}${m.subscription ? ', subscription' : ''})`,
        value: m.name,
      })),
    });

    const config = loadConfig(fugueDir);
    config.conductor = conductorChoice;
    saveConfig(fugueDir, config);

    const model = registry.models.find(m => m.name === conductorChoice);
    printSuccess(`Conductor: ${conductorChoice} (${model?.provider})`);
  }

  console.log();
  printSuccess(`Setup complete! ${registry.models.length} model(s) registered.`);
  console.log();
  console.log('  Next:');
  console.log(`  ${chalk.cyan('fugue snapshot')}                      — reverse-engineer code`);
  console.log(`  ${chalk.cyan('fugue plan import ./planning-doc.md')} — start from planning doc`);
  console.log();
  console.log(`  ${chalk.dim('To change models later:')} ${chalk.cyan('fugue model add')} / ${chalk.cyan('fugue model remove')}`);
  console.log(`  ${chalk.dim('To change conductor:')}    ${chalk.cyan('fugue config set conductor')}`);
  console.log();
}
