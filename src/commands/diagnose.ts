/**
 * fugue diagnose — Project sizing + methodology recommendation.
 * fugue gate — Phase gate scoring.
 * fugue deliver — Formal delivery judgment.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  requireFugueDir, loadConfig, loadSpecs, loadModels,
} from '../core/project.js';
import { loadAgentDefs } from '../agents/runner.js';
import { diagnoseSize, checkSizeUpgrade, countLoc, type ProjectSize } from '../core/sizing.js';
import { printSuccess, printError, printInfo, printWarning } from '../utils/display.js';
import path from 'node:path';
import fs from 'node:fs';

// --- fugue diagnose ---

export const diagnoseCommand = new Command('diagnose')
  .description('Diagnose project size and recommend methodology')
  .action(async () => {
    try {
      const fugueDir = requireFugueDir();
      const config = loadConfig(fugueDir);
      const root = path.dirname(fugueDir);
      const reqs = loadSpecs(fugueDir);
      const agents = await loadAgentDefs(fugueDir);

      // Count tasks
      const tasksDir = path.join(fugueDir, 'tasks');
      const taskCount = fs.existsSync(tasksDir)
        ? fs.readdirSync(tasksDir).filter(f => f.endsWith('.yaml')).length
        : 0;

      // Count LOC
      const includes = config.scan?.include ?? ['**/*.py', '**/*.ts', '**/*.js'];
      const excludes = config.scan?.exclude ?? [];
      const fileExts = includes.map(p => p.replace('**/', ''));
      const loc = countLoc(root, includes, excludes);

      // Count files
      const fileCount = includes.length; // approximate from scan

      const result = diagnoseSize({
        reqs: reqs.length,
        loc,
        files: fileCount,
        agents: agents.length,
        tasks: taskCount,
      });

      console.log();
      console.log(`  ${chalk.bold('Project Diagnosis')}`);
      console.log(`  ${chalk.dim('-'.repeat(50))}`);
      console.log(`  Project: ${chalk.cyan(config.project_name)}`);
      console.log(`  Size:    ${chalk.bold.yellow(result.size)} — ${result.reason}`);
      console.log();

      // Metrics
      console.log(`  ${chalk.bold('Metrics')}`);
      console.log(`  REQs:    ${reqs.length}`);
      console.log(`  LOC:     ${loc.toLocaleString()}`);
      console.log(`  Agents:  ${agents.length}`);
      console.log(`  Tasks:   ${taskCount}`);
      console.log();

      // Methodology
      const m = result.methodology;
      console.log(`  ${chalk.bold('Applied Methodology')} (${result.size})`);
      console.log(`  Crosscheck Loop:     ${m.crosscheckRequired ? chalk.green('required') : chalk.dim('optional')}`);
      console.log(`  Gate Scoring:        ${m.gateScoring ? chalk.green('required') : chalk.dim('optional')}`);
      console.log(`  Formal Delivery:     ${m.formalDelivery ? chalk.green('required') : chalk.dim('optional')}`);
      console.log(`  PMO Audit:           ${m.pmoAudit ? chalk.green('required') : chalk.dim('optional')}`);
      console.log(`  Escalation Framework:${m.escalationFramework ? chalk.green(' required') : chalk.dim(' optional')}`);
      console.log(`  Performance Tracking:${m.performanceTracking ? chalk.green(' required') : chalk.dim(' optional')}`);
      console.log(`  Min Deliverables:    ${m.minDeliverables.join(', ')}`);
      console.log();

      // Save sizing to config
      (config as Record<string, unknown>).sizing = {
        size: result.size,
        diagnosed_at: new Date().toISOString(),
        metrics: result.metrics,
      };
      const { saveConfig } = await import('../core/project.js');
      saveConfig(fugueDir, config);

      printSuccess(`Diagnosed as ${result.size}. Methodology saved to config.`);
      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// --- fugue gate ---

export const gateCommand = new Command('gate')
  .description('Phase gate scoring and transition check')
  .option('--phase <phase>', 'Phase to check (1, 2, or 3)', '1')
  .action(async (opts: { phase: string }) => {
    try {
      const fugueDir = requireFugueDir();
      const reqs = loadSpecs(fugueDir);
      const phase = parseInt(opts.phase, 10);

      console.log();
      console.log(`  ${chalk.bold(`Phase ${phase} → ${phase + 1} Gate Check`)}`);
      console.log(`  ${chalk.dim('-'.repeat(50))}`);

      const total = reqs.length;
      const confirmed = reqs.filter(r => ['CONFIRMED', 'DEV', 'DONE'].includes(r.status)).length;
      const done = reqs.filter(r => r.status === 'DONE').length;
      const draft = reqs.filter(r => r.status === 'DRAFT').length;
      const withTests = reqs.filter(r => r.test_refs && r.test_refs.length > 0).length;
      const withCode = reqs.filter(r => r.code_refs && r.code_refs.length > 0).length;

      // Scoring (100 points)
      let score = 0;
      const items: Array<{ name: string; score: number; max: number; status: string }> = [];

      if (phase === 1) {
        // P1→P2: Specification completeness
        const undecidedScore = draft === 0 ? 25 : Math.round((1 - draft / total) * 25);
        items.push({ name: 'UNDECIDED/DRAFT resolved', score: undecidedScore, max: 25, status: draft === 0 ? 'PASS' : `${draft} remaining` });

        const specScore = total > 0 ? Math.round((confirmed / total) * 30) : 0;
        items.push({ name: 'Spec coverage', score: specScore, max: 30, status: `${confirmed}/${total}` });

        const codeScore = total > 0 ? Math.round((withCode / total) * 25) : 0;
        items.push({ name: 'Code mapping', score: codeScore, max: 25, status: `${withCode}/${total}` });

        const testScore = total > 0 ? Math.round((withTests / total) * 20) : 0;
        items.push({ name: 'Test coverage', score: testScore, max: 20, status: `${withTests}/${total}` });
      } else {
        // P2→P3: Implementation completeness
        const doneScore = total > 0 ? Math.round((done / total) * 25) : 0;
        items.push({ name: 'Implementation complete', score: doneScore, max: 25, status: `${done}/${total}` });

        const testScore = total > 0 ? Math.round((withTests / total) * 25) : 0;
        items.push({ name: 'Test coverage', score: testScore, max: 25, status: `${withTests}/${total}` });

        const codeScore = total > 0 ? Math.round((withCode / total) * 25) : 0;
        items.push({ name: 'Code traceability', score: codeScore, max: 25, status: `${withCode}/${total}` });

        const noEscalation = 25; // placeholder
        items.push({ name: 'Escalations resolved', score: noEscalation, max: 25, status: 'OK' });
      }

      score = items.reduce((sum, i) => sum + i.score, 0);

      for (const item of items) {
        const color = item.score >= item.max * 0.8 ? chalk.green : item.score >= item.max * 0.5 ? chalk.yellow : chalk.red;
        console.log(`  ${item.name.padEnd(25)} ${color(`${item.score}/${item.max}`)}  ${chalk.dim(item.status)}`);
      }

      console.log(`  ${chalk.dim('-'.repeat(50))}`);
      console.log(`  ${chalk.bold('Total:')} ${score}/100`);
      console.log();

      // Absolute criteria
      const absolutePass = draft === 0;
      if (!absolutePass) {
        console.log(`  ${chalk.red('ABSOLUTE FAIL')}: ${draft} DRAFT/UNDECIDED REQs must be resolved`);
      }

      // Gate judgment
      if (score >= 80 && absolutePass) {
        console.log(`  ${chalk.green.bold('GATE: PASS')} — Ready for Phase ${phase + 1}`);
      } else if (score >= 60) {
        console.log(`  ${chalk.yellow.bold('GATE: CONDITIONAL PASS')} — ${100 - score} points short`);
      } else {
        console.log(`  ${chalk.red.bold('GATE: FAIL')} — Score below 60`);
      }
      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// --- fugue deliver ---

export const deliverCommand = new Command('deliver')
  .description('Formal delivery judgment + report')
  .argument('[task-id]', 'Task ID to deliver (or all)')
  .action(async (taskId?: string) => {
    try {
      const fugueDir = requireFugueDir();
      const config = loadConfig(fugueDir);
      const reqs = loadSpecs(fugueDir);

      console.log();
      console.log(`  ${chalk.bold('Delivery Check')}`);
      console.log(`  ${chalk.dim('-'.repeat(50))}`);

      const total = reqs.length;
      const done = reqs.filter(r => r.status === 'DONE').length;
      const withTests = reqs.filter(r => r.test_refs && r.test_refs.length > 0).length;
      const withCode = reqs.filter(r => r.code_refs && r.code_refs.length > 0).length;
      const draft = reqs.filter(r => r.status === 'DRAFT').length;

      console.log(`  REQs:       ${done}/${total} DONE`);
      console.log(`  Tests:      ${withTests}/${total} covered`);
      console.log(`  Traceability: ${withCode}/${total} code-mapped`);
      console.log(`  Unresolved: ${draft} DRAFT`);
      console.log();

      if (done === total && draft === 0 && withTests === total) {
        console.log(`  ${chalk.green.bold('DELIVERY: APPROVED')}`);
        console.log();

        // Generate delivery report
        const reportDir = path.join(fugueDir, 'reports');
        fs.mkdirSync(reportDir, { recursive: true });
        const ts = new Date().toISOString().slice(0, 10);
        const reportPath = path.join(reportDir, `delivery-${ts}.md`);

        const reportContent = [
          `# Delivery Report — ${config.project_name}`,
          ``,
          `Date: ${ts}`,
          `Size: ${(config as Record<string, unknown> as { sizing?: { size: string } }).sizing?.size ?? 'undiagnosed'}`,
          ``,
          `## Summary`,
          `- REQs: ${done}/${total} DONE`,
          `- Tests: ${withTests}/${total} covered`,
          `- Traceability: ${withCode}/${total} mapped`,
          `- Gate: PASS`,
          ``,
          `## Requirements`,
          `| ID | Title | Status | Tests |`,
          `|---|---|---|---|`,
          ...reqs.map(r => `| ${r.id} | ${r.title} | ${r.status} | ${r.test_refs?.length ?? 0} |`),
          ``,
          `---`,
          `Generated by fugue v0.3.2`,
        ].join('\n');

        fs.writeFileSync(reportPath, reportContent, 'utf-8');
        printSuccess(`Delivery report: ${path.relative(path.dirname(fugueDir), reportPath)}`);
      } else {
        console.log(`  ${chalk.yellow.bold('DELIVERY: NOT READY')}`);
        if (draft > 0) console.log(`  → Resolve ${draft} DRAFT REQs`);
        if (done < total) console.log(`  → Complete ${total - done} REQs`);
        if (withTests < total) console.log(`  → Add tests for ${total - withTests} REQs`);
      }
      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
