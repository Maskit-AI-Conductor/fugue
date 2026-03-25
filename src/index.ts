#!/usr/bin/env node

/**
 * fugue — Fugue. Conductor-based AI PMO for your terminal.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { modelCommand } from './commands/model.js';
import { configCommand } from './commands/config.js';
import { snapshotCommand } from './commands/snapshot.js';
import { planCommand } from './commands/plan.js';
import { auditCommand } from './commands/audit.js';
import { agentCommand } from './commands/agent.js';
import { statusCommand } from './commands/status.js';
import { reportCommand } from './commands/report.js';
import { notifyCommand } from './commands/notify.js';
import { setupCommand } from './commands/setup-cmd.js';
import { taskCommand } from './commands/task.js';
import { adminCommand } from './commands/admin.js';
import { diagnoseCommand, gateCommand, deliverCommand } from './commands/diagnose.js';
import { workflowCommand } from './commands/workflow.js';

const program = new Command();

program
  .name('fugue')
  .description('Fugue — Conductor-based AI PMO for your terminal')
  .version('0.7.0');

program.addCommand(initCommand);
program.addCommand(modelCommand);
program.addCommand(configCommand);
program.addCommand(snapshotCommand);
program.addCommand(planCommand);
program.addCommand(auditCommand);
program.addCommand(agentCommand);
program.addCommand(statusCommand);
program.addCommand(reportCommand);
program.addCommand(notifyCommand);
program.addCommand(setupCommand);
program.addCommand(taskCommand);
program.addCommand(adminCommand);
program.addCommand(diagnoseCommand);
program.addCommand(gateCommand);
program.addCommand(deliverCommand);
program.addCommand(workflowCommand);

const mcpCommand = new Command('mcp')
  .description('Start MCP server (for AI coding assistants)')
  .action(async () => {
    await import('./mcp/server.js');
  });
program.addCommand(mcpCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
