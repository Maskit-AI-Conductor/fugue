/**
 * bpro config — Configuration management with interactive conductor selection.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import { requireBproDir, loadConfig, saveConfig, loadModels } from '../core/project.js';
import { printSuccess, printError, printWarning, printInfo } from '../utils/display.js';

export const configCommand = new Command('config')
  .description('Manage bpro configuration');

configCommand
  .command('set <key> [value]')
  .description('Set a configuration value (e.g. conductor)')
  .action(async (key: string, value?: string) => {
    try {
      const bproDir = requireBproDir();
      const config = loadConfig(bproDir);

      switch (key) {
        case 'conductor': {
          const registry = loadModels(bproDir);

          if (registry.models.length === 0) {
            printWarning('No models registered.');
            console.log(`  Run ${chalk.cyan('bpro model add')} first.`);
            process.exit(1);
          }

          let selectedModel = value;

          // Interactive selection if no value given
          if (!selectedModel) {
            selectedModel = await select({
              message: 'Select conductor (orchestrator) model:',
              choices: registry.models.map(m => ({
                name: `${m.name} (${m.provider}${m.subscription ? ', subscription' : ''})`,
                value: m.name,
              })),
            });
          }

          const model = registry.models.find(m => m.name === selectedModel);
          if (!model) {
            printWarning(`Model '${selectedModel}' is not registered.`);
            console.log(`  Register it first: ${chalk.cyan(`bpro model add`)}`);
            process.exit(1);
          }

          config.conductor = selectedModel;
          saveConfig(bproDir, config);
          printSuccess(`Conductor set to '${selectedModel}' (${model.provider})`);
          break;
        }
        default:
          if (!value) {
            printError(`Usage: bpro config set ${key} <value>`);
            process.exit(1);
          }
          (config as Record<string, unknown>)[key] = value;
          saveConfig(bproDir, config);
          printSuccess(`${key} = ${value}`);
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'ExitPromptError') return;
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

configCommand
  .command('show')
  .description('Show current configuration')
  .action(async () => {
    try {
      const bproDir = requireBproDir();
      const config = loadConfig(bproDir);
      const registry = loadModels(bproDir);

      console.log();
      console.log(`  ${chalk.bold('bpro Configuration')}`);
      console.log(`  ${chalk.dim('-'.repeat(40))}`);
      console.log(`  Project:    ${chalk.cyan(config.project_name)}`);
      console.log(`  Version:    ${config.version}`);
      console.log(`  Created:    ${config.created}`);

      if (config.conductor) {
        const model = registry.models.find(m => m.name === config.conductor);
        console.log(`  Conductor:  ${chalk.yellow(config.conductor)} (${model?.provider ?? 'unknown'})`);
      } else {
        console.log(`  Conductor:  ${chalk.dim('not set')} — run ${chalk.cyan('bpro config set conductor')}`);
      }

      console.log(`  Models:     ${registry.models.length} registered`);
      console.log();

      if (config.scan) {
        console.log(`  ${chalk.bold('Scan')}`);
        console.log(`  Include: ${config.scan.include.length} patterns`);
        console.log(`  Exclude: ${config.scan.exclude.length} patterns`);
      }

      if (config.plan?.source) {
        console.log();
        console.log(`  ${chalk.bold('Plan')}`);
        console.log(`  Source: ${config.plan.source}`);
        console.log(`  Imported: ${config.plan.imported_at ?? 'unknown'}`);
      }
      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
