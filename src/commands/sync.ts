/**
 * fugue sync — Commit-to-matrix auto-sync + complexity detection.
 *
 * Parses git log for REQ-XXX-NNN patterns, maps changed files to
 * code_refs/test_refs, detects STALE refs, and suggests Progressive
 * Detail level upgrades.
 *
 * REQs: TRAC-001~008, PDET-003
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  requireFugueDir,
  loadConfig,
  loadSpecs,
  saveSpec,
  type ReqSpec,
  type FugueConfig,
} from '../core/project.js';
import { printSuccess, printError, printInfo, printWarning } from '../utils/display.js';

// =============================================
// REQ-ID pattern (TRAC-001)
// =============================================

const REQ_PATTERN = /REQ-[A-Z]+-\d{3}/g;

// =============================================
// Test file detection (TRAC-003)
// =============================================

function isTestFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes('test') ||
    lower.includes('spec') ||
    lower.includes('__tests__') ||
    lower.startsWith('tests/') ||
    lower.includes('/tests/')
  );
}

// =============================================
// Git log parsing (TRAC-001)
// =============================================

interface CommitInfo {
  hash: string;
  message: string;
  reqIds: string[];
  files: string[];
}

function parseGitLog(since?: string): CommitInfo[] {
  const sinceArg = since ? `${since}..HEAD` : '';
  let output: string;
  try {
    output = execSync(
      `git log ${sinceArg} --pretty=format:"COMMIT:%H|%s" --name-only`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );
  } catch {
    return [];
  }

  const commits: CommitInfo[] = [];
  let current: CommitInfo | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith('COMMIT:')) {
      if (current && current.reqIds.length > 0) commits.push(current);
      const [hash, ...msgParts] = line.slice(7).split('|');
      const message = msgParts.join('|');
      const reqIds = [...new Set(message.match(REQ_PATTERN) ?? [])];
      current = { hash, message, reqIds, files: [] };
    } else if (current && line.trim()) {
      current.files.push(line.trim());
    }
  }
  if (current && current.reqIds.length > 0) commits.push(current);

  return commits;
}

// =============================================
// Sync engine (TRAC-002, 003, 004, 007)
// =============================================

interface SyncResult {
  reqsUpdated: number;
  codeRefsAdded: number;
  testRefsAdded: number;
  staleMarked: number;
  promotions: Array<{ reqId: string; currentLevel: number; suggestedLevel: number; codeRefCount: number }>;
}

function syncSpecs(
  fuguePath: string,
  specs: ReqSpec[],
  commits: CommitInfo[],
  config: FugueConfig,
  dryRun: boolean,
): SyncResult {
  const specMap = new Map(specs.map(s => [s.id, s]));
  const result: SyncResult = {
    reqsUpdated: 0,
    codeRefsAdded: 0,
    testRefsAdded: 0,
    staleMarked: 0,
    promotions: [],
  };

  // Build REQ → files mapping from commits
  const reqFiles = new Map<string, Set<string>>();
  for (const commit of commits) {
    for (const reqId of commit.reqIds) {
      if (!reqFiles.has(reqId)) reqFiles.set(reqId, new Set());
      for (const file of commit.files) {
        reqFiles.get(reqId)!.add(file);
      }
    }
  }

  // Apply mappings (TRAC-002, 003, 007)
  for (const [reqId, files] of reqFiles) {
    const spec = specMap.get(reqId);
    if (!spec) continue;

    const existingCodeRefs = new Set(spec.code_refs ?? []);
    const existingTestRefs = new Set(spec.test_refs ?? []);
    let changed = false;

    for (const file of files) {
      if (isTestFile(file)) {
        if (!existingTestRefs.has(file)) {
          existingTestRefs.add(file);
          result.testRefsAdded++;
          changed = true;
        }
      } else {
        if (!existingCodeRefs.has(file)) {
          existingCodeRefs.add(file);
          result.codeRefsAdded++;
          changed = true;
        }
      }
    }

    if (changed) {
      spec.code_refs = [...existingCodeRefs].sort();
      spec.test_refs = [...existingTestRefs].sort();
      result.reqsUpdated++;
      if (!dryRun) saveSpec(fuguePath, spec, 'fugue-sync');
    }
  }

  // Detect STALE refs (TRAC-004)
  for (const spec of specs) {
    const refs = [...(spec.code_refs ?? []), ...(spec.test_refs ?? [])];
    for (const ref of refs) {
      if (ref !== 'STALE' && !fs.existsSync(ref)) {
        result.staleMarked++;
      }
    }
  }

  // Progressive Detail promotions (PDET-003)
  const pdetConfig = config.progressive_detail;
  const l2Threshold = pdetConfig?.l2_threshold ?? 5;
  const l3Threshold = pdetConfig?.l3_threshold ?? 10;

  for (const spec of specs) {
    const codeRefCount = (spec.code_refs ?? []).length;
    const currentLevel = spec.detail_level ?? 1;

    if (currentLevel < 2 && codeRefCount >= l2Threshold) {
      result.promotions.push({ reqId: spec.id, currentLevel, suggestedLevel: 2, codeRefCount });
    } else if (currentLevel < 3 && codeRefCount >= l3Threshold) {
      result.promotions.push({ reqId: spec.id, currentLevel, suggestedLevel: 3, codeRefCount });
    }
  }

  return result;
}

// =============================================
// CLI command
// =============================================

export const syncCommand = new Command('sync')
  .description('Sync git commits to REQ traceability matrix (TRAC-001~008)')
  .option('--since <commit>', 'Sync from this commit (default: last 100 commits)')
  .option('--dry-run', 'Show what would change without saving')
  .option('--auto-enrich', 'Automatically run enrich for promoted REQs')
  .action(async (opts: { since?: string; dryRun?: boolean; autoEnrich?: boolean }) => {
    try {
      const fuguePath = requireFugueDir();
      const config = loadConfig(fuguePath);
      const specs = loadSpecs(fuguePath);

      if (specs.length === 0) {
        printWarning('No REQ specs found. Run fugue plan decompose first.');
        return;
      }

      printInfo('Parsing git log...');
      const commits = parseGitLog(opts.since);

      if (commits.length === 0) {
        printInfo('No commits with REQ-IDs found.');
        return;
      }

      printInfo(`Found ${commits.length} commits with REQ-IDs`);

      const result = syncSpecs(fuguePath, specs, commits, config, opts.dryRun ?? false);

      // Output summary (TRAC-008)
      const prefix = opts.dryRun ? chalk.yellow('[dry-run] ') : '';
      printSuccess(
        `${prefix}${result.reqsUpdated} REQs synced, ` +
        `${result.codeRefsAdded} code_refs added, ` +
        `${result.testRefsAdded} test_refs added`,
      );

      if (result.staleMarked > 0) {
        printWarning(`${result.staleMarked} refs point to missing files (STALE)`);
      }

      // Progressive Detail promotions
      if (result.promotions.length > 0) {
        console.log('');
        printInfo('Progressive Detail promotions:');
        for (const p of result.promotions) {
          const arrow = p.suggestedLevel === 2 ? 'L2 (ai_context)' : 'L3 (Policy)';
          console.log(
            `  ${chalk.cyan('⬆')} ${p.reqId} → ${arrow} ` +
            chalk.dim(`(code_refs: ${p.codeRefCount})`),
          );
        }
        if (!opts.autoEnrich) {
          console.log(chalk.dim('\n  Run fugue enrich <REQ-ID> to accept, or ignore to dismiss.'));
        }
      }
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// Export for MCP tool reuse
export { parseGitLog, syncSpecs, isTestFile, REQ_PATTERN, type SyncResult, type CommitInfo };
