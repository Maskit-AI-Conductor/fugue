/**
 * bpro audit — Run audit (gap detection, gate judgment).
 */

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  requireBproDir,
  loadConfig,
  loadSpecs,
  loadMatrix,
  loadModels,
} from '../core/project.js';
import { getConductorAdapter } from '../models/registry.js';
import { AUDIT_SYSTEM_PROMPT, buildAuditPrompt } from '../prompts/audit.js';
import { appendAgentLog } from '../agents/runner.js';
import { printSuccess, printError, printWarning, printInfo, createSpinner } from '../utils/display.js';
import { saveYaml } from '../utils/yaml.js';
import { emitEvent } from '../notifications/index.js';

interface AuditResult {
  id: string;
  title: string;
  detail: string;
}

export const auditCommand = new Command('audit')
  .description('Run audit: check REQ coverage, test gaps, code changes')
  .option('--quick', 'Quick audit (file-based, no model call)', true)
  .option('--gate', 'Run gate judgment (PASS/CONDITIONAL/FAIL)')
  .action(async (opts: { quick?: boolean; gate?: boolean }) => {
    try {
      const bproDir = requireBproDir();
      const reqs = loadSpecs(bproDir);

      if (reqs.length === 0) {
        printWarning('No requirements to audit. Run `bpro plan import` or `bpro snapshot` first.');
        return;
      }

      const matrix = loadMatrix(bproDir);
      const entries = matrix?.entries ?? {};
      const root = path.dirname(bproDir);

      const results: Record<string, AuditResult[]> = {
        pass: [],
        warn: [],
        new: [],
        stale: [],
        fail: [],
      };

      for (const req of reqs) {
        if (req.status === 'DEPRECATED') continue;

        const entry = entries[req.id] ?? {};
        const codeRefs = entry.code_refs ?? req.code_refs ?? [];
        const testRefs = entry.test_refs ?? req.test_refs ?? [];

        const hasCode = codeRefs.length > 0;
        let codeExists = false;
        if (hasCode) {
          for (const ref of codeRefs) {
            if (fs.existsSync(path.join(root, ref))) {
              codeExists = true;
              break;
            }
          }
        }

        const hasTest = testRefs.length > 0;

        if (!hasCode) {
          if (['CONFIRMED', 'DRAFT'].includes(req.status)) {
            results.new.push({ id: req.id, title: req.title, detail: 'not implemented' });
          } else {
            results.warn.push({ id: req.id, title: req.title, detail: 'no code mapped' });
          }
        } else if (!codeExists) {
          results.stale.push({ id: req.id, title: req.title, detail: 'code file missing' });
        } else if (!hasTest) {
          results.warn.push({ id: req.id, title: req.title, detail: 'no tests' });
        } else {
          results.pass.push({ id: req.id, title: req.title, detail: 'ok' });
        }
      }

      // If --gate and not --quick, use conductor for deeper analysis
      if (opts.gate && !opts.quick) {
        const config = loadConfig(bproDir);
        const registry = loadModels(bproDir);
        try {
          const adapter = getConductorAdapter(config.conductor, registry);
          const spinner = createSpinner('Running deep audit with conductor...');
          spinner.start();

          const prompt = buildAuditPrompt(reqs);
          const deepResult = await adapter.generateJSON<{
            findings?: Array<{ req_id: string; severity: string; message: string }>;
            gate?: string;
            summary?: string;
          }>(prompt, {
            system: AUDIT_SYSTEM_PROMPT,
            maxTokens: 4096,
          });

          spinner.succeed('Deep audit complete');

          if (deepResult.summary) {
            printInfo(`Conductor: ${deepResult.summary}`);
          }

          appendAgentLog(bproDir, {
            agent: 'auditor',
            action: 'deep-audit',
            model: adapter.name,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            status: 'success',
            output_summary: deepResult.summary ?? 'audit complete',
          });
        } catch {
          printInfo('Deep audit skipped (conductor not available)');
        }
      }

      // Display results
      console.log();

      for (const [, title, detail] of results.pass.map((r) => [r.id, r.title, r.detail])) {
        // skip individual pass display for brevity
      }
      for (const r of results.pass) {
        console.log(`  ${chalk.green('PASS')}  ${r.id}: ${r.title}`);
      }
      for (const r of results.warn) {
        console.log(`  ${chalk.yellow('WARN')}  ${r.id}: ${r.title} — ${r.detail}`);
      }
      for (const r of results.new) {
        console.log(`  ${chalk.blue('TODO')}  ${r.id}: ${r.title} — ${r.detail}`);
      }
      for (const r of results.stale) {
        console.log(`  ${chalk.red('STALE')} ${r.id}: ${r.title} — ${r.detail}`);
      }

      console.log();
      console.log(
        `  PASS ${results.pass.length} | WARN ${results.warn.length} | TODO ${results.new.length} | STALE ${results.stale.length}`,
      );

      // Gate judgment
      if (opts.gate) {
        console.log();
        if (results.stale.length > 0 || results.fail.length > 0) {
          console.log(`  ${chalk.red.bold('Gate: FAIL')} — stale or failing items`);
        } else if (results.warn.length > 0 || results.new.length > 0) {
          console.log(`  ${chalk.yellow.bold('Gate: CONDITIONAL PASS')} — warnings/todos remain`);
        } else {
          console.log(`  ${chalk.green.bold('Gate: PASS')}`);
        }
      }

      // Save audit result
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const auditResult = {
        timestamp: new Date().toISOString(),
        summary: Object.fromEntries(
          Object.entries(results).map(([k, v]) => [k, v.length]),
        ),
        details: results,
      };
      const reportsDir = path.join(bproDir, 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      saveYaml(path.join(reportsDir, `audit-${ts}.yaml`), auditResult);

      console.log();
      console.log(`  ${chalk.dim(`Saved to .bpro/reports/audit-${ts}.yaml`)}`);

      // Emit notification
      const totalIssues = Object.values(auditResult.summary).reduce((a, b) => a + (b as number), 0);
      await emitEvent(bproDir, 'audit.complete', `Audit complete`, {
        Summary: Object.entries(auditResult.summary).map(([k, v]) => `${k}:${v}`).join(' '),
        'Total Items': String(totalIssues),
      });
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
