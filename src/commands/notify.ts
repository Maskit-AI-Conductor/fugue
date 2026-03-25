/**
 * bpro notify — Manage notification plugins.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { requireBproDir } from '../core/project.js';
import {
  loadNotifications,
  saveNotifications,
  type NotificationEntry,
} from '../notifications/index.js';
import { SlackPlugin } from '../notifications/slack.js';
import { printSuccess, printError, printInfo, createSpinner } from '../utils/display.js';

const DEFAULT_EVENTS = [
  'snapshot.complete',
  'audit.complete',
  'report.generated',
];

export const notifyCommand = new Command('notify')
  .description('Manage notification plugins');

notifyCommand
  .command('add <type>')
  .description('Add a notification plugin (slack)')
  .option('--webhook <url>', 'Slack webhook URL')
  .option('--events <events>', 'Comma-separated event list', DEFAULT_EVENTS.join(','))
  .action(async (type: string, opts: { webhook?: string; events?: string }) => {
    try {
      const bproDir = requireBproDir();

      if (type !== 'slack') {
        printError(`Unsupported notification type: ${type}. Currently only 'slack' is supported.`);
        process.exit(1);
      }

      if (!opts.webhook) {
        printError('--webhook is required for slack notifications.');
        console.log(`  ${chalk.cyan('bpro notify add slack --webhook https://hooks.slack.com/services/...')}`);
        process.exit(1);
      }

      const entries = loadNotifications(bproDir);

      // Check for duplicate
      const existing = entries.find(e => e.type === type);
      if (existing) {
        printError(`Notification '${type}' already configured. Remove it first: bpro notify remove ${type}`);
        process.exit(1);
      }

      const events = (opts.events ?? DEFAULT_EVENTS.join(',')).split(',').map(s => s.trim());

      const entry: NotificationEntry = {
        type: 'slack',
        webhook: opts.webhook,
        events,
        added_at: new Date().toISOString(),
      };

      entries.push(entry);
      saveNotifications(bproDir, entries);

      printSuccess(`Slack notification added (${events.length} events)`);
      console.log(`  Events: ${chalk.dim(events.join(', '))}`);
      console.log();
      console.log(`  ${chalk.dim('Test it:')} ${chalk.cyan('bpro notify test')}`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

notifyCommand
  .command('list')
  .description('List configured notifications')
  .action(async () => {
    try {
      const bproDir = requireBproDir();
      const entries = loadNotifications(bproDir);

      if (entries.length === 0) {
        printInfo('No notifications configured.');
        console.log(`  ${chalk.cyan('bpro notify add slack --webhook <url>')}`);
        return;
      }

      console.log();
      console.log(`  ${chalk.bold('Configured Notifications')}`);
      console.log(`  ${chalk.dim('-'.repeat(60))}`);

      for (const entry of entries) {
        const webhookHint = entry.webhook
          ? entry.webhook.slice(0, 30) + '...'
          : '';
        console.log(`  ${chalk.cyan(entry.type.padEnd(10))} ${chalk.dim(webhookHint)}`);
        console.log(`  ${''.padEnd(10)} Events: ${chalk.dim(entry.events.join(', '))}`);
        console.log(`  ${''.padEnd(10)} Added: ${chalk.dim(entry.added_at)}`);
        console.log();
      }
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

notifyCommand
  .command('remove <type>')
  .description('Remove a notification plugin')
  .action(async (type: string) => {
    try {
      const bproDir = requireBproDir();
      const entries = loadNotifications(bproDir);

      const idx = entries.findIndex(e => e.type === type);
      if (idx === -1) {
        printError(`Notification '${type}' not found.`);
        process.exit(1);
      }

      entries.splice(idx, 1);
      saveNotifications(bproDir, entries);

      printSuccess(`Notification '${type}' removed.`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

notifyCommand
  .command('test')
  .description('Send a test notification to all configured plugins')
  .action(async () => {
    try {
      const bproDir = requireBproDir();
      const entries = loadNotifications(bproDir);

      if (entries.length === 0) {
        printInfo('No notifications configured.');
        return;
      }

      for (const entry of entries) {
        if (entry.type === 'slack') {
          const spinner = createSpinner(`Testing ${entry.type}...`);
          spinner.start();

          const plugin = new SlackPlugin(entry.webhook);
          const ok = await plugin.test();

          if (ok) {
            spinner.succeed(`${entry.type} — test message sent`);
          } else {
            spinner.fail(`${entry.type} — failed to send test message`);
          }
        }
      }
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
