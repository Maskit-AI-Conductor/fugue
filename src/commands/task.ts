/**
 * fugue task — Task management with progressive control mode.
 *
 * Workflow: new → import → validate → decompose → confirm → assign → done
 * Requester and worker are separated roles.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  requireFugueDir,
  loadConfig,
  loadModels,
  loadSpecs,
  saveSpec,
  loadTask,
  loadTasks,
  saveTask,
  nextTaskId,
  type TaskData,
  type TaskStatus,
  type TaskEscalation,
  type ReqSpec,
} from '../core/project.js';
import { getConductorAdapter } from '../models/registry.js';
import { DECOMPOSE_SYSTEM_PROMPT, buildDecomposeSystemPrompt, buildDecomposePrompt } from '../prompts/decompose.js';
import { VALIDATE_SYSTEM_PROMPT, buildValidatePrompt, type ValidationResult } from '../prompts/validate.js';
import { postProcessReqs } from '../core/postprocess.js';
import { printSuccess, printError, printInfo, printWarning, createSpinner, printReqTable } from '../utils/display.js';
import { emitEvent } from '../notifications/index.js';

// =============================================
// Main command
// =============================================

export const taskCommand = new Command('task')
  .description('Task management — progressive control mode');

// =============================================
// task new
// =============================================

taskCommand
  .command('new <title>')
  .description('Create a new task')
  .option('--requester <name>', 'Name of the requester')
  .action(async (title: string, opts: { requester?: string }) => {
    try {
      const fugueDir = requireFugueDir();
      const taskId = nextTaskId(fugueDir);
      const now = new Date().toISOString();

      const task: TaskData = {
        id: taskId,
        title,
        requester: opts.requester,
        assignees: [],
        status: 'DRAFT',
        created_at: now,
        updated_at: now,
        req_ids: [],
        escalations: [],
      };

      saveTask(fugueDir, task);

      printSuccess(`Created ${chalk.cyan(taskId)}: ${title}`);
      if (opts.requester) {
        console.log(`  Requester: ${chalk.yellow(opts.requester)}`);
      }
      console.log(`  Status:    ${chalk.dim('DRAFT')}`);
      console.log();
      console.log(`  ${chalk.dim('Next:')} ${chalk.cyan(`fugue task import ${taskId} <file>`)} — attach planning doc`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task import
// =============================================

taskCommand
  .command('import <task-id> <file>')
  .description('Import a planning document for a task')
  .action(async (taskId: string, file: string) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);

      const srcPath = path.resolve(file);
      if (!fs.existsSync(srcPath)) {
        printError(`File not found: ${file}`);
        process.exit(1);
      }

      // Copy to .fugue/plans/
      const ext = path.extname(srcPath).toLowerCase();
      if (!['.md', '.txt', '.markdown'].includes(ext)) {
        printWarning(`Expected Markdown file, got ${ext}. Importing anyway.`);
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const destName = `${taskId}_${path.parse(srcPath).name}_${timestamp}${ext}`;
      const destPath = path.join(fugueDir, 'plans', destName);
      fs.mkdirSync(path.join(fugueDir, 'plans'), { recursive: true });
      fs.copyFileSync(srcPath, destPath);

      // Update task
      task.plan_file = path.relative(fugueDir, destPath);
      task.status = transitionStatus(task.status, 'OPEN');
      task.updated_at = new Date().toISOString();
      saveTask(fugueDir, task);

      const lineCount = fs.readFileSync(destPath, 'utf-8').split('\n').length;
      printSuccess(`Imported ${path.basename(srcPath)} (${lineCount} lines) to ${chalk.cyan(taskId)}`);
      console.log(`  ${chalk.dim(`Saved to .fugue/plans/${destName}`)}`);
      console.log(`  Status: ${formatStatus(task.status)}`);
      console.log();
      console.log(`  ${chalk.dim('Next:')} ${chalk.cyan(`fugue task validate ${taskId}`)} — check doc quality`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task validate
// =============================================

taskCommand
  .command('validate <task-id>')
  .description('Validate planning document quality (conductor)')
  .action(async (taskId: string) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);
      const config = loadConfig(fugueDir);
      const registry = loadModels(fugueDir);

      if (!task.plan_file) {
        printError(`No planning doc for ${taskId}. Run \`fugue task import ${taskId} <file>\` first.`);
        process.exit(1);
      }

      const docPath = path.join(fugueDir, task.plan_file);
      if (!fs.existsSync(docPath)) {
        printError(`Planning doc not found: ${docPath}`);
        process.exit(1);
      }

      const docContent = fs.readFileSync(docPath, 'utf-8');

      // Get conductor
      const adapter = getConductorAdapter(config.conductor, registry);
      printInfo(`Validating with ${chalk.yellow(adapter.name)}...`);

      const spinner = createSpinner('Checking document quality...');
      spinner.start();

      const healthy = await adapter.checkHealth();
      if (!healthy) {
        spinner.fail('Conductor model is not reachable');
        process.exit(1);
      }

      let result: ValidationResult;
      try {
        const prompt = buildValidatePrompt(docContent);
        result = await adapter.generateJSON<ValidationResult>(prompt, {
          system: VALIDATE_SYSTEM_PROMPT,
          maxTokens: 4096,
          temperature: 0.2,
        });
      } catch (err: unknown) {
        spinner.fail('Validation failed');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      if (!result || typeof result !== 'object') {
        spinner.fail('Model returned unexpected format');
        process.exit(1);
      }

      const issues = result.issues ?? [];
      const errors = issues.filter((i) => i.severity === 'ERROR');
      const warns = issues.filter((i) => i.severity === 'WARN');

      if (result.pass && errors.length === 0) {
        spinner.succeed('Document quality OK');
      } else {
        spinner.warn(`Found ${errors.length} error(s), ${warns.length} warning(s)`);
      }

      // Update task
      task.validation = {
        pass: result.pass && errors.length === 0,
        issue_count: issues.length,
        validated_at: new Date().toISOString(),
      };
      task.updated_at = new Date().toISOString();
      saveTask(fugueDir, task);

      // Print issues
      if (issues.length > 0) {
        console.log();
        console.log(`  ${chalk.bold('Issues:')}`);
        console.log(`  ${chalk.dim('-'.repeat(70))}`);

        for (const issue of issues) {
          const sev = issue.severity === 'ERROR'
            ? chalk.red.bold('ERR ')
            : chalk.yellow.bold('WARN');
          const typeTag = chalk.dim(`[${issue.type}]`);
          console.log(`  ${sev} ${typeTag} ${issue.location}`);
          console.log(`       ${issue.description}`);
          console.log(`       ${chalk.green('Fix:')} ${issue.suggestion}`);
          console.log();
        }
      }

      console.log();
      if (result.pass && errors.length === 0) {
        console.log(`  ${chalk.dim('Next:')} ${chalk.cyan(`fugue task decompose ${taskId}`)} — extract REQ IDs`);
      } else {
        console.log(`  ${chalk.dim('Fix issues and re-import, then validate again.')}`);
      }
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task decompose
// =============================================

taskCommand
  .command('decompose <task-id>')
  .description('Decompose planning doc into REQ IDs (conductor)')
  .action(async (taskId: string) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);
      const config = loadConfig(fugueDir);
      const registry = loadModels(fugueDir);

      if (!task.plan_file) {
        printError(`No planning doc for ${taskId}. Run \`fugue task import ${taskId} <file>\` first.`);
        process.exit(1);
      }

      const docPath = path.join(fugueDir, task.plan_file);
      if (!fs.existsSync(docPath)) {
        printError(`Planning doc not found: ${docPath}`);
        process.exit(1);
      }

      const docContent = fs.readFileSync(docPath, 'utf-8');

      // Get conductor
      const adapter = getConductorAdapter(config.conductor, registry);
      printInfo(`Decomposing with ${chalk.yellow(adapter.name)}...`);

      const spinner = createSpinner('Extracting requirements...');
      spinner.start();

      const healthy = await adapter.checkHealth();
      if (!healthy) {
        spinner.fail('Conductor model is not reachable');
        process.exit(1);
      }

      let reqsData: Array<Record<string, unknown>>;
      try {
        const prompt = buildDecomposePrompt(docContent);
        const systemPrompt = buildDecomposeSystemPrompt(config);
        reqsData = await adapter.generateJSON<Array<Record<string, unknown>>>(prompt, {
          system: systemPrompt,
          maxTokens: 4096,
          temperature: 0.2,
        });
      } catch (err: unknown) {
        spinner.fail('Decomposition failed');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      if (!Array.isArray(reqsData)) {
        spinner.fail('Model returned unexpected format');
        printError('Expected JSON array.');
        process.exit(1);
      }

      spinner.succeed(`${reqsData.length} requirements extracted`);

      // Build REQ array
      const now = new Date().toISOString();
      const rawReqs: ReqSpec[] = [];

      for (const raw of reqsData) {
        if (!raw.id) continue;
        rawReqs.push({
          id: String(raw.id),
          title: String(raw.title ?? ''),
          priority: String(raw.priority ?? 'MEDIUM'),
          description: String(raw.description ?? ''),
          status: 'DRAFT',
          created: now,
          code_refs: [],
          test_refs: [],
          source: {
            file: task.plan_file,
            section: String(raw.source_section ?? ''),
          },
        });
      }

      // Post-process: dedup, validate code_refs, adjust priorities
      const projectRoot = path.dirname(fugueDir);
      const { reqs: processedReqs, stats } = postProcessReqs(rawReqs, projectRoot, config);

      if (stats.merged > 0 || stats.priorityAdjusted > 0) {
        printInfo(
          `Post-process: ${stats.merged} merged, ${stats.invalidRefs} invalid refs removed, ${stats.priorityAdjusted} priorities adjusted`
        );
      }

      // Save REQs
      const saved: ReqSpec[] = [];
      const reqIds: string[] = [];

      for (const req of processedReqs) {
        saveSpec(fugueDir, req);
        saved.push(req);
        reqIds.push(req.id);
      }

      // Update task
      task.req_ids = reqIds;
      task.status = transitionStatus(task.status, 'DECOMPOSED');
      task.updated_at = now;
      saveTask(fugueDir, task);

      console.log();
      printReqTable(saved, `Requirements for ${taskId} (${saved.length})`);
      console.log();
      console.log(`  ${chalk.dim('Next:')} ${chalk.cyan(`fugue task confirm ${taskId}`)} — requester confirms REQs`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task confirm
// =============================================

taskCommand
  .command('confirm <task-id>')
  .description('Requester confirms decomposed REQs')
  .option('--requester <name>', 'Name of the confirming requester')
  .action(async (taskId: string, opts: { requester?: string }) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);

      if (task.req_ids.length === 0) {
        printError(`No REQs for ${taskId}. Run \`fugue task decompose ${taskId}\` first.`);
        process.exit(1);
      }

      // Load the REQs belonging to this task
      const allSpecs = loadSpecs(fugueDir);
      const taskReqs = allSpecs.filter((r) => task.req_ids.includes(r.id));
      const draftReqs = taskReqs.filter((r) => r.status === 'DRAFT');

      if (draftReqs.length === 0) {
        printWarning('No DRAFT requirements to confirm.');
        const confirmed = taskReqs.filter((r) => r.status === 'CONFIRMED');
        if (confirmed.length > 0) {
          printInfo(`${confirmed.length} REQs already confirmed.`);
        }
        return;
      }

      printReqTable(draftReqs, `Confirming ${draftReqs.length} REQs for ${taskId}`);
      console.log();

      // Prompt for confirmation
      const { confirm } = await import('@inquirer/prompts');
      const ok = await confirm({
        message: `Confirm all ${draftReqs.length} requirements?`,
        default: true,
      });

      if (!ok) {
        printInfo('Cancelled.');
        return;
      }

      // Update REQ status
      const now = new Date().toISOString();
      for (const req of draftReqs) {
        req.status = 'CONFIRMED';
        req.confirmed_at = now;
        saveSpec(fugueDir, req);
      }

      // Update task
      task.status = transitionStatus(task.status, 'CONFIRMED');
      task.updated_at = now;
      if (opts.requester) {
        task.requester = opts.requester;
      }
      saveTask(fugueDir, task);

      printSuccess(`${draftReqs.length} REQs confirmed for ${chalk.cyan(taskId)}.`);
      console.log(`  Status: ${formatStatus(task.status)}`);
      console.log();
      console.log(`  ${chalk.dim('Next:')} ${chalk.cyan(`fugue task assign ${taskId} --to <name>`)} — assign a worker`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task assign
// =============================================

taskCommand
  .command('assign <task-id>')
  .description('Assign a worker to the task')
  .requiredOption('--to <name>', 'Worker name (person or agent)')
  .action(async (taskId: string, opts: { to: string }) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);

      if (!task.assignees.includes(opts.to)) {
        task.assignees.push(opts.to);
      }

      task.status = transitionStatus(task.status, 'IN_PROGRESS');
      task.updated_at = new Date().toISOString();
      saveTask(fugueDir, task);

      printSuccess(`Assigned ${chalk.yellow(opts.to)} to ${chalk.cyan(taskId)}`);
      console.log(`  Assignees: ${task.assignees.map((a) => chalk.yellow(a)).join(', ')}`);
      console.log(`  Status:    ${formatStatus(task.status)}`);
      console.log();
      console.log(`  ${chalk.dim('When done:')} ${chalk.cyan(`fugue task done ${taskId}`)} — report completion`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task done
// =============================================

taskCommand
  .command('done <task-id>')
  .description('Report task completion + auto-verify REQs')
  .action(async (taskId: string) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);

      if (task.req_ids.length === 0) {
        printWarning(`No REQs tracked for ${taskId}. Marking as DONE anyway.`);
        task.status = 'DONE';
        task.updated_at = new Date().toISOString();
        saveTask(fugueDir, task);
        printSuccess(`${chalk.cyan(taskId)} marked as DONE`);
        return;
      }

      // Verify REQs
      const allSpecs = loadSpecs(fugueDir);
      const taskReqs = allSpecs.filter((r) => task.req_ids.includes(r.id));

      const missing: string[] = [];
      const noCodeRefs: string[] = [];

      for (const reqId of task.req_ids) {
        const req = taskReqs.find((r) => r.id === reqId);
        if (!req) {
          missing.push(reqId);
          continue;
        }
        if (!req.code_refs || req.code_refs.length === 0) {
          noCodeRefs.push(reqId);
        }
      }

      // Check unresolved escalations
      const unresolvedEsc = task.escalations.filter((e) => !e.resolved);

      const hasFail = missing.length > 0 || unresolvedEsc.length > 0;

      console.log();
      console.log(`  ${chalk.bold(`Verification for ${taskId}`)}`);
      console.log(`  ${chalk.dim('-'.repeat(50))}`);
      console.log(`  Total REQs:           ${task.req_ids.length}`);
      console.log(`  Missing specs:        ${missing.length > 0 ? chalk.red(String(missing.length)) : chalk.green('0')}`);
      console.log(`  No code_refs:         ${noCodeRefs.length > 0 ? chalk.yellow(String(noCodeRefs.length)) : chalk.green('0')}`);
      console.log(`  Unresolved escalations: ${unresolvedEsc.length > 0 ? chalk.red(String(unresolvedEsc.length)) : chalk.green('0')}`);
      console.log();

      if (hasFail) {
        printWarning('Verification FAILED. Fix issues before completing.');
        if (missing.length > 0) {
          console.log(`  Missing: ${missing.map((id) => chalk.red(id)).join(', ')}`);
        }
        if (unresolvedEsc.length > 0) {
          console.log(`  Unresolved escalations:`);
          for (const esc of unresolvedEsc) {
            console.log(`    ${chalk.red(esc.req_id)}: ${esc.reason}`);
          }
        }
        console.log();
        return;
      }

      // PASS
      task.status = 'DONE';
      task.updated_at = new Date().toISOString();
      saveTask(fugueDir, task);

      printSuccess(`${chalk.cyan(taskId)} completed`);
      if (noCodeRefs.length > 0) {
        printWarning(`${noCodeRefs.length} REQ(s) have no code_refs yet: ${noCodeRefs.join(', ')}`);
      }

      console.log();
      console.log(`  ${chalk.dim('Generate report:')} ${chalk.cyan(`fugue task report ${taskId}`)}`);

      // Emit notification
      await emitEvent(fugueDir, 'agent.task.complete', `Task ${taskId} completed: ${task.title}`, {
        taskId,
        title: task.title,
        requester: task.requester ?? '',
        reqCount: String(task.req_ids.length),
      });
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task escalate
// =============================================

taskCommand
  .command('escalate <task-id> <req-id>')
  .description('Escalate a REQ issue to requester')
  .requiredOption('--reason <text>', 'Reason for escalation')
  .action(async (taskId: string, reqId: string, opts: { reason: string }) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);

      const escalation: TaskEscalation = {
        req_id: reqId,
        reason: opts.reason,
        created_at: new Date().toISOString(),
        resolved: false,
      };

      task.escalations.push(escalation);
      task.updated_at = new Date().toISOString();
      saveTask(fugueDir, task);

      printSuccess(`Escalation added to ${chalk.cyan(taskId)}`);
      console.log(`  REQ:    ${chalk.cyan(reqId)}`);
      console.log(`  Reason: ${opts.reason}`);
      if (task.requester) {
        console.log(`  Notify: ${chalk.yellow(task.requester)}`);
      }
      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task list
// =============================================

taskCommand
  .command('list')
  .description('List all tasks')
  .option('--status <status>', 'Filter by status')
  .option('--requester <name>', 'Filter by requester')
  .action(async (opts: { status?: string; requester?: string }) => {
    try {
      const fugueDir = requireFugueDir();
      let tasks = loadTasks(fugueDir);

      if (opts.status) {
        const s = opts.status.toUpperCase();
        tasks = tasks.filter((t) => t.status === s);
      }
      if (opts.requester) {
        tasks = tasks.filter((t) => t.requester === opts.requester);
      }

      if (tasks.length === 0) {
        printInfo('No tasks found.');
        return;
      }

      console.log();
      console.log(`  ${chalk.bold(`Tasks (${tasks.length})`)}`);
      console.log();

      // Table header
      const idW = 12;
      const statusW = 15;
      const reqW = 6;
      const requesterW = 14;
      const assigneeW = 14;

      console.log(
        `  ${chalk.dim(pad('ID', idW))}${chalk.dim(pad('Status', statusW))}${chalk.dim(pad('REQs', reqW))}${chalk.dim(pad('Requester', requesterW))}${chalk.dim(pad('Assignee', assigneeW))}${chalk.dim('Title')}`
      );
      console.log(`  ${chalk.dim('-'.repeat(80))}`);

      for (const task of tasks) {
        const statusStr = formatStatus(task.status);
        const reqCount = String(task.req_ids.length);
        const requester = task.requester ?? '-';
        const assignee = task.assignees.length > 0 ? task.assignees.join(',') : '-';

        console.log(
          `  ${chalk.cyan(pad(task.id, idW))}${pad('', 0)}${statusStr}${' '.repeat(Math.max(0, statusW - stripAnsi(statusStr).length))}${pad(reqCount, reqW)}${pad(requester, requesterW)}${pad(assignee.slice(0, assigneeW - 2), assigneeW)}${task.title}`
        );
      }

      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task show
// =============================================

taskCommand
  .command('show <task-id>')
  .description('Show task details')
  .action(async (taskId: string) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);

      console.log();
      console.log(`  ${chalk.bold(task.id)}: ${task.title}`);
      console.log(`  ${chalk.dim('-'.repeat(60))}`);
      console.log(`  Status:      ${formatStatus(task.status)}`);
      console.log(`  Requester:   ${task.requester ? chalk.yellow(task.requester) : chalk.dim('-')}`);
      console.log(`  Assignees:   ${task.assignees.length > 0 ? task.assignees.map((a) => chalk.yellow(a)).join(', ') : chalk.dim('-')}`);
      console.log(`  Created:     ${chalk.dim(task.created_at)}`);
      console.log(`  Updated:     ${chalk.dim(task.updated_at ?? '-')}`);
      console.log(`  Plan file:   ${task.plan_file ? chalk.dim(task.plan_file) : chalk.dim('-')}`);

      if (task.validation) {
        const vIcon = task.validation.pass ? chalk.green('PASS') : chalk.red('FAIL');
        console.log(`  Validation:  ${vIcon} (${task.validation.issue_count} issues, ${chalk.dim(task.validation.validated_at)})`);
      }

      // REQs
      if (task.req_ids.length > 0) {
        console.log();
        console.log(`  ${chalk.bold('REQs')} (${task.req_ids.length}):`);
        const allSpecs = loadSpecs(fugueDir);
        for (const reqId of task.req_ids) {
          const spec = allSpecs.find((s) => s.id === reqId);
          if (spec) {
            const statusFn = getStatusColor(spec.status);
            console.log(`    ${chalk.cyan(reqId)}  ${statusFn(spec.status.padEnd(12))}${spec.title}`);
          } else {
            console.log(`    ${chalk.cyan(reqId)}  ${chalk.red('NOT FOUND')}`);
          }
        }
      }

      // Escalations
      if (task.escalations.length > 0) {
        console.log();
        console.log(`  ${chalk.bold('Escalations')} (${task.escalations.length}):`);
        for (const esc of task.escalations) {
          const resolved = esc.resolved ? chalk.green('RESOLVED') : chalk.red('OPEN');
          console.log(`    ${chalk.cyan(esc.req_id)}  ${resolved}  ${esc.reason}`);
          console.log(`    ${chalk.dim(`    ${esc.created_at}`)}`);
        }
      }

      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// task report
// =============================================

taskCommand
  .command('report <task-id>')
  .description('Generate a Markdown report for the task')
  .action(async (taskId: string) => {
    try {
      const fugueDir = requireFugueDir();
      const task = requireTask(fugueDir, taskId);
      const allSpecs = loadSpecs(fugueDir);
      const taskReqs = allSpecs.filter((r) => task.req_ids.includes(r.id));

      const lines: string[] = [];
      lines.push(`# Task Report: ${task.id}`);
      lines.push('');
      lines.push(`## Overview`);
      lines.push('');
      lines.push(`| Field | Value |`);
      lines.push(`|-------|-------|`);
      lines.push(`| Title | ${task.title} |`);
      lines.push(`| Status | ${task.status} |`);
      lines.push(`| Requester | ${task.requester ?? '-'} |`);
      lines.push(`| Assignees | ${task.assignees.join(', ') || '-'} |`);
      lines.push(`| Created | ${task.created_at} |`);
      lines.push(`| Updated | ${task.updated_at ?? '-'} |`);
      lines.push(`| Plan file | ${task.plan_file ?? '-'} |`);
      lines.push('');

      // Validation
      if (task.validation) {
        lines.push(`## Validation`);
        lines.push('');
        lines.push(`- Result: ${task.validation.pass ? 'PASS' : 'FAIL'}`);
        lines.push(`- Issues: ${task.validation.issue_count}`);
        lines.push(`- Validated at: ${task.validation.validated_at}`);
        lines.push('');
      }

      // REQs
      lines.push(`## Requirements (${taskReqs.length})`);
      lines.push('');
      if (taskReqs.length > 0) {
        lines.push(`| ID | Status | Priority | Title |`);
        lines.push(`|----|--------|----------|-------|`);
        for (const req of taskReqs) {
          lines.push(`| ${req.id} | ${req.status} | ${req.priority} | ${req.title} |`);
        }
      } else {
        lines.push('No requirements decomposed yet.');
      }
      lines.push('');

      // Code coverage
      const withRefs = taskReqs.filter((r) => r.code_refs && r.code_refs.length > 0);
      lines.push(`## Coverage`);
      lines.push('');
      lines.push(`- REQs with code_refs: ${withRefs.length}/${taskReqs.length}`);
      lines.push('');

      // Escalations
      if (task.escalations.length > 0) {
        lines.push(`## Escalations (${task.escalations.length})`);
        lines.push('');
        lines.push(`| REQ | Status | Reason |`);
        lines.push(`|-----|--------|--------|`);
        for (const esc of task.escalations) {
          lines.push(`| ${esc.req_id} | ${esc.resolved ? 'RESOLVED' : 'OPEN'} | ${esc.reason} |`);
        }
        lines.push('');
      }

      lines.push(`---`);
      lines.push(`Generated: ${new Date().toISOString()}`);

      // Save report
      const reportsDir = path.join(fugueDir, 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      const reportName = `${taskId}_report_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`;
      const reportPath = path.join(reportsDir, reportName);
      fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');

      printSuccess(`Report generated: ${chalk.dim(reportPath)}`);
      console.log();

      // Also emit notification
      await emitEvent(fugueDir, 'report.generated', `Report generated for ${taskId}`, {
        taskId,
        title: task.title,
        reportPath,
      });
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// =============================================
// Helpers
// =============================================

function requireTask(fugueDir: string, taskId: string): TaskData {
  const normalized = taskId.toUpperCase();
  const task = loadTask(fugueDir, normalized);
  if (!task) {
    throw new Error(`Task ${normalized} not found. Run \`fugue task list\` to see tasks.`);
  }
  return task;
}

/**
 * Transition task status. Allows forward transitions; backward requires explicit override.
 */
const STATUS_ORDER: TaskStatus[] = ['DRAFT', 'OPEN', 'DECOMPOSED', 'CONFIRMED', 'IN_PROGRESS', 'DONE', 'CLOSED'];

function transitionStatus(current: TaskStatus, target: TaskStatus): TaskStatus {
  const currentIdx = STATUS_ORDER.indexOf(current);
  const targetIdx = STATUS_ORDER.indexOf(target);
  // Allow forward transitions or staying at same level
  if (targetIdx >= currentIdx) {
    return target;
  }
  // For backward transitions, just return current (no regression)
  return current;
}

const TASK_STATUS_COLORS: Record<string, (s: string) => string> = {
  DRAFT: chalk.dim,
  OPEN: chalk.blue,
  DECOMPOSED: chalk.magenta,
  CONFIRMED: chalk.cyan,
  IN_PROGRESS: chalk.yellow,
  DONE: chalk.green,
  CLOSED: chalk.dim.strikethrough,
};

function formatStatus(status: string): string {
  const fn = TASK_STATUS_COLORS[status] ?? chalk.white;
  return fn(status);
}

function getStatusColor(status: string): (s: string) => string {
  const colors: Record<string, (s: string) => string> = {
    DRAFT: chalk.dim,
    CONFIRMED: chalk.blue,
    DEV: chalk.yellow,
    DONE: chalk.green,
  };
  return colors[status] ?? chalk.white;
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

/**
 * Strip ANSI escape codes for length calculation.
 */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001B\[[0-9;]*m/g, '');
}
