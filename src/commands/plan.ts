/**
 * fugue plan — Forward path: planning doc -> REQ IDs -> development.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  requireFugueDir,
  loadConfig,
  saveConfig,
  loadModels,
  loadSpecs,
  saveSpec,
  saveMatrix,
  type ReqSpec,
} from '../core/project.js';
import { getConductorAdapter } from '../models/registry.js';
import { createEmptyMatrix } from '../core/matrix.js';
import { DECOMPOSE_SYSTEM_PROMPT, buildDecomposeSystemPrompt, buildDecomposePrompt } from '../prompts/decompose.js';
import { postProcessReqs } from '../core/postprocess.js';
import { printSuccess, printError, printInfo, printWarning, createSpinner, printReqTable } from '../utils/display.js';

export const planCommand = new Command('plan')
  .description('Forward path: planning doc -> REQ IDs -> development');

planCommand
  .command('import <source>')
  .description('Import a planning document (Markdown file or Notion URL)')
  .action(async (source: string) => {
    try {
      const fugueDir = requireFugueDir();
      const isNotion = source.includes('notion.so') || source.includes('notion.site');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      let destPath: string;
      let lineCount: number;
      let displayName: string;

      if (isNotion) {
        // Notion URL → fetch and convert to markdown
        const spinner = createSpinner('Fetching from Notion...');
        spinner.start();

        try {
          const { notionPageToMarkdown } = await import('../core/notion.js');
          const { title, markdown } = await notionPageToMarkdown(source);

          const safeName = title.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 50);
          const destName = `${safeName}_${timestamp}.md`;
          destPath = path.join(fugueDir, 'plans', destName);
          fs.mkdirSync(path.join(fugueDir, 'plans'), { recursive: true });
          fs.writeFileSync(destPath, markdown, 'utf-8');

          lineCount = markdown.split('\n').length;
          displayName = title;
          spinner.succeed(`Fetched "${title}" from Notion (${lineCount} lines)`);
        } catch (err: unknown) {
          spinner.fail('Failed to fetch from Notion');
          printError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      } else {
        // Local file
        const srcPath = path.resolve(source);

        if (!fs.existsSync(srcPath)) {
          printError(`File not found: ${source}`);
          process.exit(1);
        }

        const ext = path.extname(srcPath).toLowerCase();
        if (!['.md', '.txt', '.markdown'].includes(ext)) {
          printWarning(`Expected Markdown file, got ${ext}. Importing anyway.`);
        }

        const destName = `${path.parse(srcPath).name}_${timestamp}${ext}`;
        destPath = path.join(fugueDir, 'plans', destName);
        fs.mkdirSync(path.join(fugueDir, 'plans'), { recursive: true });
        fs.copyFileSync(srcPath, destPath);

        lineCount = fs.readFileSync(destPath, 'utf-8').split('\n').length;
        displayName = path.basename(srcPath);
      }

      // Update config
      const config = loadConfig(fugueDir);
      if (!config.plan) config.plan = {};
      config.plan.source = path.relative(fugueDir, destPath);
      config.plan.imported_at = new Date().toISOString();
      config.plan.original_path = isNotion ? source : path.resolve(source);
      saveConfig(fugueDir, config);

      printSuccess(`Imported ${displayName} (${lineCount} lines)`);
      console.log(`  ${chalk.dim(`Saved to .fugue/plans/${path.basename(destPath)}`)}`);
      console.log();
      console.log(`  ${chalk.dim('Next:')} ${chalk.cyan('fugue plan decompose')} — extract REQ IDs`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

planCommand
  .command('decompose')
  .description('Decompose planning doc into REQ IDs using conductor model')
  .action(async () => {
    try {
      const fugueDir = requireFugueDir();
      const config = loadConfig(fugueDir);
      const registry = loadModels(fugueDir);

      const planSource = config.plan?.source;
      if (!planSource) {
        printError('No planning doc imported. Run `fugue plan import <file>` first.');
        process.exit(1);
      }

      const docPath = path.join(fugueDir, planSource);
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

      // Build REQ array — continue numbering from existing specs
      const now = new Date().toISOString();
      const existingSpecs = loadSpecs(fugueDir);

      // Determine area prefix from config + plan source filename
      const areas = config.generation?.req_naming?.areas;
      let areaPrefix = '';
      if (areas) {
        const planFileName = path.basename(planSource ?? '').toLowerCase();
        // Match by: area code in filename, or label words in filename
        for (const [code, label] of Object.entries(areas)) {
          const labelStr = String(label).toLowerCase();
          const codeLC = code.toLowerCase();
          // Split label into words and check if any word (3+ chars) appears in filename
          const labelWords = labelStr.split(/[\s&/,]+/).filter(w => w.length >= 3);
          const filenameMatch = labelWords.some(w => planFileName.includes(w));
          if (planFileName.includes(codeLC) || filenameMatch) {
            areaPrefix = code;
            break;
          }
        }
      }

      // Find max existing number for this area (or global)
      const idPattern = areaPrefix
        ? new RegExp(`REQ-${areaPrefix}-(\\d+)`)
        : /REQ-(\d+)/;
      const maxExistingNum = existingSpecs.reduce((max, s) => {
        const match = s.id.match(idPattern);
        return match ? Math.max(max, parseInt(match[1], 10)) : max;
      }, 0);
      let nextNum = maxExistingNum + 1;

      const rawReqs: ReqSpec[] = [];

      for (const raw of reqsData) {
        if (!raw.id) continue;
        const newId = areaPrefix
          ? `REQ-${areaPrefix}-${String(nextNum).padStart(3, '0')}`
          : `REQ-${String(nextNum).padStart(3, '0')}`;
        nextNum++;
        rawReqs.push({
          id: newId,
          title: String(raw.title ?? ''),
          priority: String(raw.priority ?? 'MEDIUM'),
          description: String(raw.description ?? ''),
          status: 'DRAFT',
          created: now,
          code_refs: [],
          test_refs: [],
          source: {
            file: planSource,
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
      for (const req of processedReqs) {
        saveSpec(fugueDir, req);
        saved.push(req);
      }

      console.log();
      printReqTable(saved, `Requirements (${saved.length})`);
      console.log();
      console.log(`  ${chalk.dim('Review the REQs above, then:')} ${chalk.cyan('fugue plan confirm')}`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

planCommand
  .command('feedback <req-id> [message]')
  .description('Give feedback on a REQ (accept, reject, or comment)')
  .option('--accept', 'Accept this REQ')
  .option('--reject', 'Reject this REQ (will be DEPRECATED on confirm)')
  .option('--from <name>', 'Feedback author name')
  .action(async (reqId: string, message?: string, opts?: { accept?: boolean; reject?: boolean; from?: string }) => {
    try {
      const fugueDir = requireFugueDir();
      const reqs = loadSpecs(fugueDir);
      const req = reqs.find(r => r.id === reqId);

      if (!req) {
        printError(`REQ not found: ${reqId}`);
        process.exit(1);
      }

      // Determine action
      let action: 'accept' | 'reject' | 'comment';
      if (opts?.accept) {
        action = 'accept';
      } else if (opts?.reject) {
        action = 'reject';
      } else {
        action = 'comment';
      }

      if (action === 'comment' && !message) {
        printError('Provide a comment message: fugue plan feedback REQ-001 "your feedback"');
        process.exit(1);
      }

      // Append feedback
      const feedbackList = (req.feedback as Array<Record<string, string>>) ?? [];
      feedbackList.push({
        from: opts?.from ?? 'reviewer',
        action,
        message: message ?? (action === 'accept' ? 'Accepted' : 'Rejected'),
        at: new Date().toISOString(),
      });
      req.feedback = feedbackList;

      // Mark status
      if (action === 'reject') {
        req.status = 'REJECTED';
      } else if (action === 'accept') {
        req.status = 'ACCEPTED';
      }
      // comment leaves status as-is

      saveSpec(fugueDir, req);

      const icon = action === 'accept' ? chalk.green('✔') : action === 'reject' ? chalk.red('✖') : chalk.blue('💬');
      const label = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'commented';
      console.log(`  ${icon} ${reqId}: ${label}${message ? ` — ${message}` : ''}`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

planCommand
  .command('review')
  .description('Interactive review: accept/reject/comment each DRAFT REQ')
  .option('--from <name>', 'Reviewer name')
  .action(async (opts: { from?: string }) => {
    try {
      const fugueDir = requireFugueDir();
      const reqs = loadSpecs(fugueDir);
      const drafts = reqs.filter(r => r.status === 'DRAFT');

      if (drafts.length === 0) {
        printWarning('No DRAFT REQs to review.');
        return;
      }

      const { select, input } = await import('@inquirer/prompts');

      console.log();
      console.log(`  ${chalk.bold(`Reviewing ${drafts.length} REQs`)}`);
      console.log();

      let accepted = 0, rejected = 0, commented = 0;

      for (const req of drafts) {
        console.log(`  ${chalk.cyan(req.id)} ${chalk.bold(req.title)}`);
        if (req.description) console.log(`  ${chalk.dim(req.description)}`);
        console.log(`  Priority: ${req.priority}`);
        console.log();

        const action = await select({
          message: `${req.id}:`,
          choices: [
            { name: 'accept', value: 'accept' },
            { name: 'reject', value: 'reject' },
            { name: 'comment (add feedback, keep DRAFT)', value: 'comment' },
            { name: 'skip', value: 'skip' },
          ],
        });

        if (action === 'skip') continue;

        let message = '';
        if (action === 'reject' || action === 'comment') {
          message = await input({ message: 'Reason:' });
        }

        const feedbackList = (req.feedback as Array<Record<string, string>>) ?? [];
        feedbackList.push({
          from: opts.from ?? 'reviewer',
          action,
          message: message || (action === 'accept' ? 'Accepted' : 'Rejected'),
          at: new Date().toISOString(),
        });
        req.feedback = feedbackList;

        if (action === 'accept') { req.status = 'ACCEPTED'; accepted++; }
        else if (action === 'reject') { req.status = 'REJECTED'; rejected++; }
        else { commented++; }

        saveSpec(fugueDir, req);
      }

      console.log();
      printSuccess(`Review complete: ${accepted} accepted, ${rejected} rejected, ${commented} commented`);
      if (accepted > 0 || rejected > 0) {
        console.log(`  ${chalk.dim('Next:')} ${chalk.cyan('fugue plan confirm')} — finalize accepted REQs`);
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'ExitPromptError') return;
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

planCommand
  .command('confirm')
  .description('Confirm accepted REQs, deprecate rejected ones')
  .action(async () => {
    try {
      const fugueDir = requireFugueDir();
      const reqs = loadSpecs(fugueDir);

      const accepted = reqs.filter(r => r.status === 'ACCEPTED');
      const rejected = reqs.filter(r => r.status === 'REJECTED');
      const drafts = reqs.filter(r => r.status === 'DRAFT');
      const toConfirm = [...accepted, ...drafts]; // ACCEPTED + remaining DRAFT

      if (toConfirm.length === 0 && rejected.length === 0) {
        printWarning('No requirements to confirm.');
        const confirmed = reqs.filter(r => r.status === 'CONFIRMED');
        if (confirmed.length > 0) {
          printInfo(`${confirmed.length} REQs already confirmed.`);
        }
        return;
      }

      // Show summary
      console.log();
      if (accepted.length > 0) {
        console.log(`  ${chalk.green('✔')} ${accepted.length} accepted — will be CONFIRMED`);
      }
      if (drafts.length > 0) {
        console.log(`  ${chalk.blue('○')} ${drafts.length} unreviewed (DRAFT) — will also be CONFIRMED`);
      }
      if (rejected.length > 0) {
        console.log(`  ${chalk.red('✖')} ${rejected.length} rejected — will be DEPRECATED`);
        for (const r of rejected) {
          const fb = (r.feedback as Array<Record<string, string>>)?.slice(-1)[0];
          console.log(`    ${chalk.dim(r.id)}: ${r.title} ${fb?.message ? chalk.dim(`— ${fb.message}`) : ''}`);
        }
      }
      console.log();

      // Prompt for confirmation
      const { confirm } = await import('@inquirer/prompts');
      const ok = await confirm({
        message: `Confirm ${toConfirm.length} REQs${rejected.length > 0 ? `, deprecate ${rejected.length}` : ''}?`,
        default: true,
      });

      if (!ok) {
        printInfo('Cancelled.');
        return;
      }

      // Update statuses
      const now = new Date().toISOString();
      for (const req of toConfirm) {
        req.status = 'CONFIRMED';
        req.confirmed_at = now;
        saveSpec(fugueDir, req);
      }
      for (const req of rejected) {
        req.status = 'DEPRECATED';
        req.deprecated_at = now;
        saveSpec(fugueDir, req);
      }

      // Create traceability matrix (only for confirmed)
      const matrix = createEmptyMatrix(toConfirm);
      saveMatrix(fugueDir, matrix);

      printSuccess(`${toConfirm.length} REQs confirmed${rejected.length > 0 ? `, ${rejected.length} deprecated` : ''}. Development phase started.`);
      console.log();
      console.log(`  ${chalk.dim('Next:')}`);
      console.log(`  ${chalk.cyan('fugue status')}            — check progress`);
      console.log(`  ${chalk.cyan('fugue audit --quick')}     — run first audit`);
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

planCommand
  .command('history <req-id>')
  .description('View full history of a REQ (creation, feedback, status changes)')
  .action(async (reqId: string) => {
    try {
      const fugueDir = requireFugueDir();
      const reqs = loadSpecs(fugueDir);
      const req = reqs.find(r => r.id === reqId);

      if (!req) {
        printError(`REQ not found: ${reqId}`);
        process.exit(1);
      }

      console.log();
      console.log(`  ${chalk.bold(req.id)}: ${req.title}`);
      console.log(`  ${chalk.dim('-'.repeat(50))}`);
      console.log(`  Priority:    ${req.priority}`);
      console.log(`  Status:      ${req.status}`);
      console.log(`  Description: ${req.description}`);
      if (req.code_refs && req.code_refs.length > 0) {
        console.log(`  Code refs:   ${req.code_refs.join(', ')}`);
      }
      if (req.test_refs && req.test_refs.length > 0) {
        console.log(`  Test refs:   ${req.test_refs.join(', ')}`);
      }
      console.log();

      // Timeline
      console.log(`  ${chalk.bold('History')}`);
      console.log(`  ${chalk.dim('-'.repeat(50))}`);

      // Created
      console.log(`  ${chalk.dim(req.created?.slice(0, 19) ?? '?')}  ${chalk.blue('CREATED')}  status: DRAFT`);

      // Feedback entries
      const feedbackList = (req.feedback as Array<Record<string, string>>) ?? [];
      for (const fb of feedbackList) {
        const date = fb.at?.slice(0, 19) ?? '?';
        const actionColor = fb.action === 'accept' ? chalk.green : fb.action === 'reject' ? chalk.red : chalk.blue;
        const from = fb.from ? chalk.dim(`by ${fb.from}`) : '';
        console.log(`  ${chalk.dim(date)}  ${actionColor(fb.action.toUpperCase().padEnd(8))}  ${fb.message ?? ''} ${from}`);
      }

      // Confirmed/deprecated
      if (req.confirmed_at) {
        console.log(`  ${chalk.dim(String(req.confirmed_at).slice(0, 19))}  ${chalk.green('CONFIRMED')}`);
      }
      if (req.deprecated_at) {
        console.log(`  ${chalk.dim(String(req.deprecated_at).slice(0, 19))}  ${chalk.red('DEPRECATED')}`);
      }

      console.log();
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
