/**
 * bpro snapshot — Conductor-based reverse-engineering with staging area.
 *
 * Workflow:
 * 1. conductor analyzes project structure + code
 * 2. aiops assigns models to generated agent roles
 * 3. domain-analyst agents extract REQs per domain
 * 4. results saved to .bpro/staging/ (pending)
 *
 * Subcommands:
 *   bpro snapshot          — run analysis, save to staging
 *   bpro snapshot review   — diff staging vs specs
 *   bpro snapshot apply    — promote staging to specs
 *   bpro snapshot discard  — delete staging
 */

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  requireBproDir,
  loadConfig,
  loadModels,
  loadSpecs,
  saveSpec,
  saveMatrix,
  deleteSpec,
  saveStagingSpec,
  saveStagingMeta,
  loadStagingSpecs,
  loadStagingMeta,
  hasStagingData,
  clearStaging,
  diffStagingVsSpecs,
  type ReqSpec,
  type TraceMatrix,
  type DiffEntry,
  type StagingMeta,
} from '../core/project.js';
import { getConductorAdapter, getAdapter } from '../models/registry.js';
import { runConductorAnalysis, extractRequirements } from '../agents/conductor.js';
import { assignModels } from '../agents/aiops.js';
import { saveAgentDef, appendAgentLog } from '../agents/runner.js';
import { printSuccess, printError, printInfo, printWarning, createSpinner } from '../utils/display.js';
import { minimatch } from '../utils/glob.js';
import { emitEvent } from '../notifications/index.js';

const MAX_FILE_SIZE = 50_000;
const MAX_BATCH_CHARS = 15_000;

// --- Elapsed time helper ---
function formatElapsed(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

// --- Main snapshot command with subcommands ---

export const snapshotCommand = new Command('snapshot')
  .description('Reverse-engineer codebase into requirements (staging workflow)')
  .option('--clean', 'Clear existing specs before running snapshot')
  .action(async (opts: { clean?: boolean }) => {
    await runSnapshot(opts);
  });

// Subcommand: review
snapshotCommand
  .command('review')
  .description('Review pending staging changes vs existing specs')
  .action(async () => {
    await runReview();
  });

// Subcommand: apply
snapshotCommand
  .command('apply')
  .description('Apply staging changes to specs')
  .option('--force', 'Overwrite CONFIRMED/DEV/DONE specs too')
  .action(async (opts: { force?: boolean }) => {
    await runApply(opts);
  });

// Subcommand: discard
snapshotCommand
  .command('discard')
  .description('Discard pending staging data')
  .action(async () => {
    await runDiscard();
  });

// =============================================
// snapshot (main) — analyze + save to staging
// =============================================

async function runSnapshot(opts: { clean?: boolean }): Promise<void> {
  try {
    const bproDir = requireBproDir();
    const config = loadConfig(bproDir);
    const registry = loadModels(bproDir);
    const root = path.dirname(bproDir);

    // Warn if staging already has data
    if (hasStagingData(bproDir)) {
      printWarning('Staging area already has pending data. It will be overwritten.');
    }

    // --clean: clear existing specs first
    if (opts.clean) {
      const specsDir = path.join(bproDir, 'specs');
      if (fs.existsSync(specsDir)) {
        const files = fs.readdirSync(specsDir).filter((f) => f.endsWith('.yaml'));
        for (const f of files) fs.unlinkSync(path.join(specsDir, f));
      }
      printInfo('Cleared existing specs');
    }

    // Clear any previous staging
    clearStaging(bproDir);

    // 1. Get conductor
    const conductorAdapter = getConductorAdapter(config.conductor, registry);
    console.log();
    console.log(`${chalk.blue('>')} Conductor: ${chalk.yellow(conductorAdapter.name)} (maestro)`);

    // 2. Scan files
    const files = scanFiles(root, config);
    if (files.length === 0) {
      printError('No source files found. Check scan.include in .bpro/config.yaml');
      process.exit(1);
    }
    console.log(`${chalk.blue('>')} Found ${chalk.bold(String(files.length))} source files`);
    console.log();

    // 3. Print work plan
    console.log(`  ${chalk.bold('Step 1/4')}  Conductor analysis         ${chalk.dim('[est. ~30s]')}`);
    console.log(`  ${chalk.bold('Step 2/4')}  AIOps model assignment     ${chalk.dim('[instant]')}`);
    console.log(`  ${chalk.bold('Step 3/4')}  Domain analysis            ${chalk.dim('[est. ~2min]')}`);
    console.log(`  ${chalk.bold('Step 4/4')}  Save results to staging    ${chalk.dim('[instant]')}`);
    console.log(`  ${chalk.dim('\u2500'.repeat(40))}`);
    console.log(`  Total estimated: ${chalk.dim('~2.5 min')}`);
    console.log();

    // 4. Health check
    const healthSpinner = createSpinner('Checking conductor...');
    healthSpinner.start();
    const healthy = await conductorAdapter.checkHealth();
    if (!healthy) {
      healthSpinner.fail('Conductor model is not reachable');
      process.exit(1);
    }
    healthSpinner.succeed('Conductor ready');

    // 5. Conductor analyzes project — Step 1/4
    const step1Start = Date.now();
    const analysisSpinner = createSpinner(`Step 1/4: Conductor analyzing project...`);
    analysisSpinner.start();
    const startTime = new Date().toISOString();

    const fileContents = files.map((f) => ({
      path: path.relative(root, f),
      content: fs.readFileSync(f, 'utf-8'),
    }));

    let analysis;
    try {
      analysis = await runConductorAnalysis(conductorAdapter, fileContents, config.project_name);
      const elapsed = formatElapsed(Date.now() - step1Start);
      analysisSpinner.succeed(
        `Step 1/4: ${analysis.domains.length} domains, ${analysis.agent_roles.length} agents ${chalk.dim(`(${elapsed})`)}`
      );
    } catch (err: unknown) {
      analysisSpinner.fail('Step 1/4: Conductor analysis failed');
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    // Log conductor
    appendAgentLog(bproDir, {
      agent: 'conductor',
      action: 'snapshot-analysis',
      model: conductorAdapter.name,
      started_at: startTime,
      completed_at: new Date().toISOString(),
      status: 'success',
      output_summary: `${analysis.domains.length} domains, ${analysis.agent_roles.length} roles`,
      details: analysis,
    });

    // 6. AIOps assigns models — Step 2/4
    const step2Start = Date.now();
    const assignments = assignModels(analysis.agent_roles, registry, config.conductor!);
    const step2Elapsed = formatElapsed(Date.now() - step2Start);
    console.log(`${chalk.green('\u2714')} Step 2/4: Models assigned ${chalk.dim(`(${step2Elapsed})`)}`);
    for (const a of assignments) {
      console.log(`    ${chalk.cyan(a.agentName.padEnd(20))} -> ${chalk.yellow(a.assignedModel)} ${chalk.dim(`(${a.reason})`)}`);
    }

    // Save agent definitions
    for (const a of assignments) {
      const role = analysis.agent_roles.find((r) => r.name === a.agentName);
      saveAgentDef(bproDir, {
        name: a.agentName,
        type: a.agentType,
        scope: role?.scope ?? '',
        assigned_model: a.assignedModel,
        created_at: new Date().toISOString(),
      });
    }

    // 7. Extract requirements per domain — Step 3/4
    console.log();
    console.log(`  Step 3/4: Domain analysis`);
    const allReqs: ReqSpec[] = [];
    let reqCounter = 1;
    const modelAssignmentsForMeta: Array<{ agent: string; model: string }> = [];
    const totalDomains = analysis.domains.length;
    let completedDomains = 0;

    for (const domain of analysis.domains) {
      const domainAnalyst = assignments.find(
        (a) => a.agentType === 'domain-analyst' && a.agentName.includes(domain.name),
      ) ?? assignments.find((a) => a.agentType === 'domain-analyst');

      const adapterName = domainAnalyst?.assignedModel ?? config.conductor!;
      const adapter = getAdapter(registry, adapterName);

      modelAssignmentsForMeta.push({ agent: domainAnalyst?.agentName ?? domain.name, model: adapterName });

      const domainFiles = fileContents.filter((f) =>
        domain.files.some((df) => {
          const fBase = path.basename(f.path);
          const dfBase = path.basename(df);
          return f.path.includes(df) || df.includes(f.path) || fBase === dfBase;
        }),
      );

      const filesToAnalyze = domainFiles.length > 0 ? domainFiles : fileContents;
      if (domainFiles.length === 0 && analysis.domains.indexOf(domain) > 0) continue;

      const domainStart = Date.now();
      const domainSpinner = createSpinner(
        `    ${domain.name.padEnd(18)} ${chalk.dim(`[${adapterName}]`)}  ...`
      );
      domainSpinner.start();

      const batches = batchFiles(filesToAnalyze);
      let domainReqCount = 0;

      for (const batch of batches) {
        try {
          const batchReqs = await extractRequirements(adapter, batch, reqCounter);
          if (Array.isArray(batchReqs)) {
            for (const raw of batchReqs) {
              const req: ReqSpec = {
                id: `REQ-${String(reqCounter).padStart(3, '0')}`,
                title: String(raw.title ?? ''),
                priority: String(raw.priority ?? 'MEDIUM'),
                description: String(raw.description ?? ''),
                status: 'DRAFT',
                created: new Date().toISOString(),
                code_refs: (raw.source_files as string[]) ?? [],
                test_refs: [],
                assigned_model: adapterName,
              };
              reqCounter++;
              domainReqCount++;
              allReqs.push(req);
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          printInfo(`Batch error [${domain.name}]: ${msg.slice(0, 300)}`);
        }
      }

      completedDomains++;
      const domainElapsed = formatElapsed(Date.now() - domainStart);
      domainSpinner.succeed(
        `    ${domain.name.padEnd(18)} ${chalk.dim(`[${adapterName}]`)}  ${domainReqCount} REQs ${chalk.dim(`(${domainElapsed})`)}`
      );

      // Progress line
      console.log(
        chalk.dim(`    ${completedDomains}/${totalDomains} domains | ${allReqs.length} REQs so far`)
      );

      appendAgentLog(bproDir, {
        agent: domainAnalyst?.agentName ?? 'domain-analyst',
        action: 'extract-requirements',
        model: adapterName,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        status: 'success',
        output_summary: `${domain.name}: ${filesToAnalyze.length} files analyzed, ${domainReqCount} REQs`,
      });
    }

    // Fallback if domains had no file matches
    if (allReqs.length === 0 && fileContents.length > 0) {
      const fallbackStart = Date.now();
      const fallbackSpinner = createSpinner('Fallback: analyzing all files...');
      fallbackSpinner.start();

      const batches = batchFiles(fileContents);
      for (const batch of batches) {
        try {
          const batchReqs = await extractRequirements(conductorAdapter, batch, reqCounter);
          if (Array.isArray(batchReqs)) {
            for (const raw of batchReqs) {
              const req: ReqSpec = {
                id: `REQ-${String(reqCounter).padStart(3, '0')}`,
                title: String(raw.title ?? ''),
                priority: String(raw.priority ?? 'MEDIUM'),
                description: String(raw.description ?? ''),
                status: 'DRAFT',
                created: new Date().toISOString(),
                code_refs: (raw.source_files as string[]) ?? [],
                test_refs: [],
              };
              reqCounter++;
              allReqs.push(req);
            }
          }
        } catch (err: unknown) {
          printInfo(`Fallback error: ${err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)}`);
        }
      }
      const fbElapsed = formatElapsed(Date.now() - fallbackStart);
      fallbackSpinner.succeed(`Extracted ${allReqs.length} REQs ${chalk.dim(`(${fbElapsed})`)}`);
    }

    if (allReqs.length === 0) {
      printError('No requirements extracted. Try with different source files.');
      process.exit(1);
    }

    // 8. Save to staging — Step 4/4
    for (const req of allReqs) {
      saveStagingSpec(bproDir, req);
    }

    const meta: StagingMeta = {
      timestamp: new Date().toISOString(),
      conductor: conductorAdapter.name,
      model_assignments: modelAssignmentsForMeta,
      total_reqs: allReqs.length,
    };
    saveStagingMeta(bproDir, meta);

    console.log();
    console.log(`${chalk.green('\u2714')} Step 4/4: ${allReqs.length} REQs saved to staging`);

    // 9. Show staging summary
    const diff = diffStagingVsSpecs(bproDir);
    printDiffSummary(diff);

    console.log();
    console.log(`  ${chalk.bold('Next:')}`);
    console.log(`    ${chalk.cyan('bpro snapshot review')}   \u2014 review changes one by one`);
    console.log(`    ${chalk.cyan('bpro snapshot apply')}    \u2014 accept all changes`);
    console.log(`    ${chalk.cyan('bpro snapshot discard')}  \u2014 discard and keep current`);
    console.log();

    // Emit notification
    await emitEvent(bproDir, 'snapshot.complete', `Snapshot complete: ${allReqs.length} REQs extracted`, {
      'REQs': String(allReqs.length),
      'Conductor': conductorAdapter.name,
    });
  } catch (err: unknown) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// =============================================
// snapshot review — diff staging vs specs
// =============================================

async function runReview(): Promise<void> {
  try {
    const bproDir = requireBproDir();

    if (!hasStagingData(bproDir)) {
      printError('No staging data found. Run `bpro snapshot` first.');
      process.exit(1);
    }

    const meta = loadStagingMeta(bproDir);
    if (meta) {
      console.log();
      console.log(`  ${chalk.bold('Staging Info')}`);
      console.log(`  Conductor: ${chalk.yellow(meta.conductor)}`);
      console.log(`  Created:   ${chalk.dim(meta.timestamp)}`);
      console.log(`  Total:     ${meta.total_reqs} REQs`);
    }

    const diff = diffStagingVsSpecs(bproDir);
    printDiffSummary(diff);

    // Show details per entry
    console.log();
    console.log(`  ${chalk.bold('Details:')}`);
    console.log(`  ${chalk.dim('\u2500'.repeat(60))}`);

    for (const entry of diff) {
      const tag = getDiffTag(entry.status);

      if (entry.status === 'SAME') {
        // Don't show details for unchanged items
        continue;
      }

      console.log(`  ${tag} ${chalk.cyan(entry.id)}  ${entry.title}`);

      if (entry.status === 'CHANGED' && entry.changes) {
        for (const field of entry.changes) {
          const oldVal = (entry.existingSpec as Record<string, unknown>)?.[field] ?? '';
          const newVal = (entry.stagingSpec as Record<string, unknown>)?.[field] ?? '';
          console.log(`      ${chalk.dim(field)}: ${chalk.red(String(oldVal).slice(0, 80))} -> ${chalk.green(String(newVal).slice(0, 80))}`);
        }
      }

      if (entry.status === 'PROTECTED') {
        console.log(`      ${chalk.dim(`status: ${entry.existingSpec?.status} (protected, won't be overwritten)`)}`);
      }

      if (entry.status === 'REMOVED') {
        console.log(`      ${chalk.dim(`Will be removed from specs (status: ${entry.existingSpec?.status})`)}`);
      }
    }

    console.log();
    console.log(`  ${chalk.bold('Actions:')}`);
    console.log(`    ${chalk.cyan('bpro snapshot apply')}    \u2014 accept changes`);
    console.log(`    ${chalk.cyan('bpro snapshot apply --force')}  \u2014 also overwrite PROTECTED`);
    console.log(`    ${chalk.cyan('bpro snapshot discard')}  \u2014 discard staging`);
    console.log();
  } catch (err: unknown) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// =============================================
// snapshot apply — promote staging to specs
// =============================================

async function runApply(opts: { force?: boolean }): Promise<void> {
  try {
    const bproDir = requireBproDir();

    if (!hasStagingData(bproDir)) {
      printError('No staging data found. Run `bpro snapshot` first.');
      process.exit(1);
    }

    const diff = diffStagingVsSpecs(bproDir);
    const force = opts.force ?? false;

    let added = 0;
    let changed = 0;
    let removed = 0;
    let skipped = 0;
    let kept = 0;

    for (const entry of diff) {
      switch (entry.status) {
        case 'NEW':
          if (entry.stagingSpec) {
            saveSpec(bproDir, entry.stagingSpec);
            added++;
          }
          break;

        case 'CHANGED':
          if (entry.stagingSpec) {
            saveSpec(bproDir, entry.stagingSpec);
            changed++;
          }
          break;

        case 'SAME':
          kept++;
          break;

        case 'PROTECTED':
          if (force && entry.stagingSpec) {
            saveSpec(bproDir, entry.stagingSpec);
            changed++;
            printWarning(`Force-overwritten PROTECTED: ${entry.id} (${entry.existingSpec?.status})`);
          } else {
            skipped++;
            if (entry.stagingSpec) {
              // Staging had a different version but we skip it
              printInfo(`Skipped PROTECTED: ${entry.id} (${entry.existingSpec?.status})`);
            }
          }
          break;

        case 'REMOVED':
          if (entry.existingSpec) {
            const isProtected = ['CONFIRMED', 'DEV', 'DONE'].includes(entry.existingSpec.status);
            if (isProtected && !force) {
              skipped++;
              printInfo(`Kept PROTECTED: ${entry.id} (${entry.existingSpec.status})`);
            } else if (isProtected && force) {
              deleteSpec(bproDir, entry.id);
              removed++;
              printWarning(`Force-removed PROTECTED: ${entry.id}`);
            } else {
              deleteSpec(bproDir, entry.id);
              removed++;
            }
          }
          break;
      }
    }

    // Rebuild matrix from final specs
    const finalSpecs = loadSpecs(bproDir);
    const matrix: TraceMatrix = {
      version: 1,
      created: new Date().toISOString(),
      entries: Object.fromEntries(
        finalSpecs.map((r) => [r.id, { code_refs: r.code_refs ?? [], test_refs: r.test_refs ?? [] }]),
      ),
    };
    saveMatrix(bproDir, matrix);

    // Clear staging
    clearStaging(bproDir);

    console.log();
    printSuccess('Staging applied to specs');
    console.log(`  Added:   ${chalk.green(String(added))}`);
    console.log(`  Changed: ${chalk.yellow(String(changed))}`);
    console.log(`  Removed: ${chalk.red(String(removed))}`);
    console.log(`  Skipped: ${chalk.dim(String(skipped))} (protected)`);
    console.log(`  Kept:    ${chalk.dim(String(kept))} (unchanged)`);
    console.log(`  Total specs: ${chalk.bold(String(finalSpecs.length))}`);
    console.log();
  } catch (err: unknown) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// =============================================
// snapshot discard — clear staging
// =============================================

async function runDiscard(): Promise<void> {
  try {
    const bproDir = requireBproDir();

    if (!hasStagingData(bproDir)) {
      printInfo('No staging data to discard.');
      return;
    }

    const stagingSpecs = loadStagingSpecs(bproDir);
    clearStaging(bproDir);

    printSuccess(`Discarded ${stagingSpecs.length} staged REQs`);
    console.log(`  ${chalk.dim('Existing specs are unchanged.')}`);
    console.log();
  } catch (err: unknown) {
    printError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// =============================================
// Display helpers
// =============================================

function getDiffTag(status: string): string {
  switch (status) {
    case 'NEW':       return chalk.green.bold('[NEW]');
    case 'CHANGED':   return chalk.yellow.bold('[CHANGED]');
    case 'SAME':      return chalk.dim('[SAME]');
    case 'REMOVED':   return chalk.red.bold('[REMOVED]');
    case 'PROTECTED': return chalk.magenta.bold('[PROTECTED]');
    default:          return chalk.dim(`[${status}]`);
  }
}

function printDiffSummary(diff: DiffEntry[]): void {
  const counts = { NEW: 0, CHANGED: 0, SAME: 0, REMOVED: 0, PROTECTED: 0 };
  for (const entry of diff) {
    if (entry.status in counts) {
      counts[entry.status as keyof typeof counts]++;
    }
  }

  console.log();
  console.log(`  ${chalk.bold('Staging Summary')} (vs existing ${counts.SAME + counts.CHANGED + counts.PROTECTED + counts.REMOVED} REQs):`);
  console.log(`    ${chalk.green('NEW:')}        ${counts.NEW}`);
  console.log(`    ${chalk.yellow('CHANGED:')}    ${counts.CHANGED}`);
  console.log(`    ${chalk.dim('SAME:')}       ${counts.SAME}`);
  console.log(`    ${chalk.red('REMOVED:')}    ${counts.REMOVED}`);
  console.log(`    ${chalk.magenta('PROTECTED:')}  ${counts.PROTECTED} ${chalk.dim('(CONFIRMED/DEV/DONE \u2014 won\'t be overwritten)')}`);
}

// =============================================
// File scanning helpers (unchanged)
// =============================================

function scanFiles(root: string, config: { scan?: { include?: string[]; exclude?: string[] } }): string[] {
  const includes = config.scan?.include ?? ['**/*.py'];
  const excludes = config.scan?.exclude ?? [];
  const files: Set<string> = new Set();

  for (const pattern of includes) {
    for (const f of globSync(root, pattern)) {
      if (!fs.statSync(f).isFile()) continue;
      if (fs.statSync(f).size > MAX_FILE_SIZE) continue;
      const rel = path.relative(root, f);
      if (excludes.some((ex) => minimatch(rel, ex))) continue;
      files.add(f);
    }
  }

  return [...files].sort();
}

function globSync(root: string, pattern: string): string[] {
  const results: string[] = [];
  const parts = pattern.split('/');

  function walk(dir: string, partIdx: number): void {
    if (partIdx >= parts.length) return;

    const part = parts[partIdx];
    const isLast = partIdx === parts.length - 1;

    if (part === '**') {
      walk(dir, partIdx + 1);
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full, partIdx);
          }
        }
      } catch {
        // permission error
      }
    } else {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (minimatch(entry.name, part)) {
            if (isLast) {
              results.push(full);
            } else if (entry.isDirectory()) {
              walk(full, partIdx + 1);
            }
          }
        }
      } catch {
        // permission error
      }
    }
  }

  walk(root, 0);
  return results;
}

function batchFiles(
  files: Array<{ path: string; content: string }>,
): Array<Array<{ path: string; content: string }>> {
  const batches: Array<Array<{ path: string; content: string }>> = [];
  let current: Array<{ path: string; content: string }> = [];
  let currentSize = 0;

  for (const f of files) {
    const entrySize = f.content.length + f.path.length + 50;
    if (currentSize + entrySize > MAX_BATCH_CHARS && current.length > 0) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(f);
    currentSize += entrySize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
