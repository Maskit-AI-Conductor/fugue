/**
 * fugue admin — Cross-project monitoring dashboard.
 */

import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadAdminConfig, saveAdminConfig, getProjectStats, getUsageStats,
  type AdminProject,
} from '../core/admin.js';
import { printSuccess, printError, printWarning, printInfo } from '../utils/display.js';

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'claude-opus': { input: 0.015, output: 0.075 },
  'claude-sonnet': { input: 0.003, output: 0.015 },
  'gemini-pro': { input: 0.00035, output: 0.0014 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'codex': { input: 0.005, output: 0.015 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  for (const [key, rates] of Object.entries(COST_PER_1K)) {
    if (model.includes(key)) {
      return (tokensIn / 1000) * rates.input + (tokensOut / 1000) * rates.output;
    }
  }
  if (model.includes('ollama')) return 0;
  return 0;
}

export const adminCommand = new Command('admin')
  .description('Cross-project monitoring dashboard');

adminCommand
  .command('register <projectPath>')
  .description('Register a project for monitoring')
  .action(async (projectPath: string) => {
    const absPath = path.resolve(projectPath);
    const config = loadAdminConfig();

    if (config.projects.find(p => p.path === absPath)) {
      printWarning(`Already registered: ${absPath}`);
      return;
    }

    const proj: AdminProject = {
      name: path.basename(absPath),
      path: absPath,
      registered_at: new Date().toISOString(),
    };
    config.projects.push(proj);
    saveAdminConfig(config);

    const stats = getProjectStats(proj);
    printSuccess(`Registered: ${proj.name}`);
    if (!stats.initialized) {
      console.log(`  ${chalk.yellow('WARN')} .fugue/ not found. Run ${chalk.cyan('fugue init')} in that project.`);
    } else {
      console.log(`  ${chalk.dim(`${stats.reqs} REQs, ${stats.agents} agents, ${stats.tasks} tasks`)}`);
    }
  });

adminCommand
  .command('unregister <projectPath>')
  .description('Remove a project from monitoring')
  .action(async (projectPath: string) => {
    const absPath = path.resolve(projectPath);
    const config = loadAdminConfig();
    const idx = config.projects.findIndex(p => p.path === absPath);
    if (idx === -1) {
      printError(`Not registered: ${absPath}`);
      return;
    }
    const name = config.projects[idx].name;
    config.projects.splice(idx, 1);
    saveAdminConfig(config);
    printSuccess(`Unregistered: ${name}`);
  });

adminCommand
  .command('projects')
  .description('List registered projects')
  .action(async () => {
    const config = loadAdminConfig();
    if (config.projects.length === 0) {
      printInfo('No projects registered.');
      console.log(`  ${chalk.cyan('fugue admin register ~/path/to/project')}`);
      return;
    }
    console.log();
    console.log(`  ${chalk.bold('Registered Projects')} (${config.projects.length})`);
    console.log(`  ${chalk.dim('-'.repeat(60))}`);
    for (const p of config.projects) {
      const stats = getProjectStats(p);
      const status = stats.initialized ? chalk.green('✓') : chalk.yellow('○');
      console.log(`  ${status} ${chalk.cyan(p.name.padEnd(25))}${chalk.dim(p.path)}`);
    }
    console.log();
  });

adminCommand
  .command('overview')
  .description('All projects status at a glance')
  .action(async () => {
    const config = loadAdminConfig();
    if (config.projects.length === 0) {
      printInfo('No projects registered. Run `fugue admin register <path>`');
      return;
    }

    console.log();
    console.log(`  ${chalk.bold('Fugue Admin')} — ${config.projects.length} projects`);
    console.log();

    // Header
    console.log(`  ${chalk.dim('Project'.padEnd(22))}${chalk.dim('REQs'.padEnd(8))}${chalk.dim('Done'.padEnd(8))}${chalk.dim('Agents'.padEnd(8))}${chalk.dim('Tasks'.padEnd(8))}${chalk.dim('Conductor'.padEnd(18))}${chalk.dim('Last Activity')}`);
    console.log(`  ${chalk.dim('-'.repeat(90))}`);

    let totalReqs = 0, totalDone = 0, totalAgents = 0, totalTasks = 0;

    for (const proj of config.projects) {
      const s = getProjectStats(proj);
      totalReqs += s.reqs;
      totalDone += s.done;
      totalAgents += s.agents;
      totalTasks += s.tasks;

      if (!s.initialized) {
        console.log(`  ${chalk.dim(s.name.padEnd(22))}${chalk.dim('--'.padEnd(8))}${chalk.dim('--'.padEnd(8))}${chalk.dim('--'.padEnd(8))}${chalk.dim('--'.padEnd(8))}${chalk.dim('--'.padEnd(18))}${chalk.yellow('not initialized')}`);
      } else {
        const doneRate = s.reqs > 0 ? `${Math.round(s.done / s.reqs * 100)}%` : '-';
        const conductor = s.conductor ?? chalk.dim('none');
        const activity = s.lastActivity ?? chalk.dim('no logs');
        console.log(`  ${chalk.cyan(s.name.padEnd(22))}${String(s.reqs).padEnd(8)}${(String(s.done) + ` (${doneRate})`).padEnd(8)}${String(s.agents).padEnd(8)}${String(s.tasks).padEnd(8)}${String(conductor).padEnd(18)}${activity}`);
      }
    }

    console.log(`  ${chalk.dim('-'.repeat(90))}`);
    console.log(`  ${chalk.bold('Total'.padEnd(22))}${chalk.bold(String(totalReqs).padEnd(8))}${chalk.bold(String(totalDone).padEnd(8))}${chalk.bold(String(totalAgents).padEnd(8))}${chalk.bold(String(totalTasks))}`);
    console.log();
  });

adminCommand
  .command('usage')
  .description('Usage statistics across all projects')
  .option('--period <days>', 'Period in days', '7')
  .action(async (opts: { period: string }) => {
    const config = loadAdminConfig();
    if (config.projects.length === 0) {
      printInfo('No projects registered.');
      return;
    }

    const days = parseInt(opts.period, 10) || 7;
    const { models, commands, totalCalls } = getUsageStats(config.projects, days);

    console.log();
    console.log(`  ${chalk.bold(`Usage (last ${days} days)`)} — ${totalCalls} total calls`);
    console.log();

    if (models.length > 0) {
      console.log(`  ${chalk.bold('Models')}`);
      console.log(`  ${chalk.dim('Model'.padEnd(25))}${chalk.dim('Calls'.padEnd(8))}${chalk.dim('Tokens In'.padEnd(12))}${chalk.dim('Tokens Out'.padEnd(12))}${chalk.dim('Est. Cost')}`);
      console.log(`  ${chalk.dim('-'.repeat(65))}`);

      let totalCost = 0;
      for (const m of models) {
        const cost = estimateCost(m.model, m.tokens_in, m.tokens_out);
        totalCost += cost;
        const costStr = cost > 0 ? `$${cost.toFixed(2)}` : chalk.green('$0.00');
        console.log(`  ${chalk.cyan(m.model.padEnd(25))}${String(m.calls).padEnd(8)}${m.tokens_in.toLocaleString().padEnd(12)}${m.tokens_out.toLocaleString().padEnd(12)}${costStr}`);
      }
      console.log(`  ${chalk.dim('-'.repeat(65))}`);
      console.log(`  ${chalk.bold('Total'.padEnd(25))}${chalk.bold(String(totalCalls).padEnd(8))}${''.padEnd(24)}${chalk.bold(`$${totalCost.toFixed(2)}`)}`);
      console.log();
    }

    if (commands.length > 0) {
      console.log(`  ${chalk.bold('Commands (by frequency)')}`);
      console.log(`  ${chalk.dim('-'.repeat(30))}`);
      for (const c of commands.slice(0, 10)) {
        console.log(`  ${c.command.padEnd(25)}${c.count}`);
      }
      console.log();
    }
  });
