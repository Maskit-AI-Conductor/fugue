/**
 * MCP Tool definitions and handlers for Fugue.
 *
 * All tools are file I/O only — no LLM calls.
 * The host AI session handles analysis and judgment.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  initProject,
  requireFugueDir,
  getFugueDir,
  loadConfig,
  loadSpecs,
  saveSpec,
  loadMatrix,
  loadTasks,
  saveTask,
  nextTaskId,
  saveStagingSpec,
  saveStagingMeta,
  type ReqSpec,
  type TaskData,
  type StagingMeta,
} from '../core/project.js';
import { countByStatus } from '../core/requirements.js';
import { getMatrixCoverage } from '../core/matrix.js';
import { buildDeliverables } from '../core/deliverables.js';
import { diagnoseSize, countLoc } from '../core/sizing.js';
import { loadAgentDefs, saveAgentDef, type AgentDefinition } from '../agents/runner.js';
import { minimatch } from '../utils/glob.js';

// =============================================
// Types
// =============================================

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// =============================================
// Helper
// =============================================

function textResult(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function resolveFugueDir(inputPath?: string): string {
  return requireFugueDir(inputPath ?? process.cwd());
}

// =============================================
// Tool List
// =============================================

export function getToolList(): ToolDef[] {
  return [
    {
      name: 'fugue_init',
      description: 'Initialize a .fugue/ directory for a project. Creates config, subdirectories, and default files.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project root path (default: cwd)' },
          force: { type: 'boolean', description: 'Overwrite existing .fugue/ if present' },
        },
      },
    },
    {
      name: 'fugue_get_plan',
      description: 'Read and return the imported planning document content. The host AI reads this to analyze requirements.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
      },
    },
    {
      name: 'fugue_save_reqs',
      description: 'Save an array of requirements to .fugue/specs/. Used by the host AI to persist analyzed requirements.',
      inputSchema: {
        type: 'object',
        properties: {
          reqs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
                description: { type: 'string' },
                source_section: { type: 'string' },
              },
              required: ['id', 'title', 'priority', 'description'],
            },
            description: 'Array of requirement objects to save',
          },
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
        required: ['reqs'],
      },
    },
    {
      name: 'fugue_get_specs',
      description: 'Get current requirements list from .fugue/specs/. Returns all REQ specs with status counts.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
          status: { type: 'string', description: 'Filter by status (DRAFT, CONFIRMED, DEV, DONE, etc.)' },
          domain: { type: 'string', description: 'Filter by domain prefix in REQ ID' },
        },
      },
    },
    {
      name: 'fugue_status',
      description: 'Get project status overview: REQ counts, coverage metrics, deliverable tree.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
          deliverables: { type: 'boolean', description: 'Include deliverable tree (D.01-D.08)' },
        },
      },
    },
    {
      name: 'fugue_audit',
      description: 'Run file-based audit: check REQ coverage, test gaps, code ref validity. Returns structured results.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
          gate: { type: 'boolean', description: 'Include gate judgment (PASS/CONDITIONAL/FAIL)' },
        },
      },
    },
    {
      name: 'fugue_feedback',
      description: 'Give feedback on a requirement: accept, reject, or add a comment.',
      inputSchema: {
        type: 'object',
        properties: {
          reqId: { type: 'string', description: 'Requirement ID (e.g. REQ-001)' },
          action: { type: 'string', enum: ['accept', 'reject', 'comment'], description: 'Feedback action' },
          message: { type: 'string', description: 'Feedback message (required for comment, optional for accept/reject)' },
          from: { type: 'string', description: 'Author of the feedback' },
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
        required: ['reqId', 'action'],
      },
    },
    {
      name: 'fugue_confirm',
      description: 'Finalize requirements: ACCEPTED becomes CONFIRMED, REJECTED becomes DEPRECATED.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
      },
    },
    {
      name: 'fugue_task_new',
      description: 'Create a new task in .fugue/tasks/.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title' },
          requester: { type: 'string', description: 'Name of the requester' },
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
        required: ['title'],
      },
    },
    {
      name: 'fugue_task_list',
      description: 'List all tasks with their status, REQ count, requester, and assignees.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
          status: { type: 'string', description: 'Filter by task status' },
        },
      },
    },
    {
      name: 'fugue_diagnose',
      description: 'Diagnose project size (XS/S/M/L/XL) and recommend methodology based on REQ count, LOC, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
      },
    },
    {
      name: 'fugue_gate',
      description: 'Run phase gate scoring. Returns score out of 100 and PASS/CONDITIONAL/FAIL judgment.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
          phase: { type: 'number', description: 'Phase number to check (1 or 2, default: 1)' },
        },
      },
    },
    {
      name: 'fugue_report',
      description: 'Generate an HTML progress report and save to .fugue/reports/.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
      },
    },
    {
      name: 'fugue_snapshot_scan',
      description: 'Scan project source files and return file list with previews. The host AI uses this to analyze the codebase.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
      },
    },
    {
      name: 'fugue_snapshot_save',
      description: 'Save snapshot results (requirements and optional agent definitions) to staging area.',
      inputSchema: {
        type: 'object',
        properties: {
          reqs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                priority: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
                description: { type: 'string' },
                code_refs: { type: 'array', items: { type: 'string' } },
                domain: { type: 'string' },
              },
              required: ['id', 'title', 'priority', 'description'],
            },
            description: 'Array of requirements extracted from code analysis',
          },
          agents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string' },
                scope: { type: 'string' },
              },
              required: ['name', 'type', 'scope'],
            },
            description: 'Optional agent definitions to save',
          },
          path: { type: 'string', description: 'Project path (default: cwd)' },
        },
        required: ['reqs'],
      },
    },
  ];
}

// =============================================
// Request Handler
// =============================================

export async function handleRequest(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'fugue_init': return handleInit(args);
      case 'fugue_get_plan': return handleGetPlan(args);
      case 'fugue_save_reqs': return handleSaveReqs(args);
      case 'fugue_get_specs': return handleGetSpecs(args);
      case 'fugue_status': return handleStatus(args);
      case 'fugue_audit': return handleAudit(args);
      case 'fugue_feedback': return handleFeedback(args);
      case 'fugue_confirm': return handleConfirm(args);
      case 'fugue_task_new': return handleTaskNew(args);
      case 'fugue_task_list': return handleTaskList(args);
      case 'fugue_diagnose': return handleDiagnose(args);
      case 'fugue_gate': return handleGate(args);
      case 'fugue_report': return handleReport(args);
      case 'fugue_snapshot_scan': return handleSnapshotScan(args);
      case 'fugue_snapshot_save': return handleSnapshotSave(args);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(message);
  }
}

// =============================================
// Tool Implementations
// =============================================

function handleInit(args: Record<string, unknown>): ToolResult {
  const rootPath = args.path as string | undefined;
  const force = args.force as boolean | undefined;
  const fugueDir = initProject(rootPath, force ?? false);
  return textResult({ success: true, fugueDir });
}

function handleGetPlan(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const config = loadConfig(fugueDir);

  const planSource = config.plan?.source;
  if (!planSource) {
    return errorResult('No planning doc imported. Use fugue_init then import a planning doc.');
  }

  const docPath = path.join(fugueDir, planSource);
  if (!fs.existsSync(docPath)) {
    return errorResult(`Planning doc not found: ${docPath}`);
  }

  const content = fs.readFileSync(docPath, 'utf-8');
  const lineCount = content.split('\n').length;
  const title = path.basename(docPath);

  return textResult({ title, content, lineCount });
}

function handleSaveReqs(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const reqInputs = args.reqs as Array<{
    id: string;
    title: string;
    priority: string;
    description: string;
    source_section?: string;
  }>;

  if (!Array.isArray(reqInputs) || reqInputs.length === 0) {
    return errorResult('reqs must be a non-empty array');
  }

  const now = new Date().toISOString();
  const savedIds: string[] = [];

  for (const raw of reqInputs) {
    const req: ReqSpec = {
      id: raw.id,
      title: raw.title,
      priority: raw.priority,
      description: raw.description,
      status: 'DRAFT',
      created: now,
      code_refs: [],
      test_refs: [],
      source: raw.source_section ? { section: raw.source_section } : undefined,
    };
    saveSpec(fugueDir, req);
    savedIds.push(req.id);
  }

  return textResult({ saved: savedIds.length, ids: savedIds });
}

function handleGetSpecs(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  let reqs = loadSpecs(fugueDir);

  const statusFilter = args.status as string | undefined;
  if (statusFilter) {
    reqs = reqs.filter((r) => r.status === statusFilter.toUpperCase());
  }

  const domainFilter = args.domain as string | undefined;
  if (domainFilter) {
    reqs = reqs.filter((r) => r.id.includes(domainFilter.toUpperCase()));
  }

  const byStatus = countByStatus(reqs);

  return textResult({
    reqs,
    total: reqs.length,
    byStatus,
  });
}

function handleStatus(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const config = loadConfig(fugueDir);
  const reqs = loadSpecs(fugueDir);
  const matrix = loadMatrix(fugueDir);
  const counts = countByStatus(reqs);
  const coverage = getMatrixCoverage(matrix);

  const result: Record<string, unknown> = {
    summary: `${config.project_name}: ${counts.done}/${counts.total} done, ${counts.confirmed} confirmed, ${counts.draft} draft`,
    reqs: {
      total: counts.total,
      done: counts.done,
      confirmed: counts.confirmed,
      draft: counts.draft,
    },
    coverage: {
      code: `${coverage.codeMapped}/${coverage.total}`,
      test: `${coverage.testMapped}/${coverage.total}`,
    },
  };

  if (args.deliverables) {
    const deliverables = buildDeliverables(fugueDir, config, reqs, matrix);
    result.deliverables = deliverables;
  }

  return textResult(result);
}

function handleAudit(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const reqs = loadSpecs(fugueDir);

  if (reqs.length === 0) {
    return errorResult('No requirements to audit.');
  }

  const matrix = loadMatrix(fugueDir);
  const entries = matrix?.entries ?? {};
  const root = path.dirname(fugueDir);

  const results: Record<string, Array<{ id: string; title: string; status: string; detail: string }>> = {
    pass: [],
    warn: [],
    todo: [],
    stale: [],
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
        results.todo.push({ id: req.id, title: req.title, status: req.status, detail: 'not implemented' });
      } else {
        results.warn.push({ id: req.id, title: req.title, status: req.status, detail: 'no code mapped' });
      }
    } else if (!codeExists) {
      results.stale.push({ id: req.id, title: req.title, status: req.status, detail: 'code file missing' });
    } else if (!hasTest) {
      results.warn.push({ id: req.id, title: req.title, status: req.status, detail: 'no tests' });
    } else {
      results.pass.push({ id: req.id, title: req.title, status: req.status, detail: 'ok' });
    }
  }

  const response: Record<string, unknown> = {
    results: {
      pass: results.pass.length,
      warn: results.warn.length,
      todo: results.todo.length,
      stale: results.stale.length,
    },
    details: [
      ...results.pass,
      ...results.warn,
      ...results.todo,
      ...results.stale,
    ],
  };

  if (args.gate) {
    if (results.stale.length > 0) {
      response.gate = 'FAIL';
    } else if (results.warn.length > 0 || results.todo.length > 0) {
      response.gate = 'CONDITIONAL PASS';
    } else {
      response.gate = 'PASS';
    }
  }

  return textResult(response);
}

function handleFeedback(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const reqId = args.reqId as string;
  const action = args.action as 'accept' | 'reject' | 'comment';
  const message = args.message as string | undefined;
  const from = args.from as string | undefined;

  const reqs = loadSpecs(fugueDir);
  const req = reqs.find((r) => r.id === reqId);

  if (!req) {
    return errorResult(`REQ not found: ${reqId}`);
  }

  if (action === 'comment' && !message) {
    return errorResult('message is required for comment action');
  }

  // Append feedback
  const feedbackList = (req.feedback as Array<Record<string, string>>) ?? [];
  feedbackList.push({
    from: from ?? 'mcp-client',
    action,
    message: message ?? (action === 'accept' ? 'Accepted' : action === 'reject' ? 'Rejected' : ''),
    at: new Date().toISOString(),
  });
  req.feedback = feedbackList;

  // Update status
  if (action === 'reject') {
    req.status = 'REJECTED';
  } else if (action === 'accept') {
    req.status = 'ACCEPTED';
  }

  saveSpec(fugueDir, req);

  return textResult({ success: true, reqId, newStatus: req.status });
}

function handleConfirm(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const reqs = loadSpecs(fugueDir);

  const now = new Date().toISOString();
  let confirmed = 0;
  let deprecated = 0;

  for (const req of reqs) {
    if (req.status === 'ACCEPTED' || req.status === 'DRAFT') {
      req.status = 'CONFIRMED';
      req.confirmed_at = now;
      saveSpec(fugueDir, req);
      confirmed++;
    } else if (req.status === 'REJECTED') {
      req.status = 'DEPRECATED';
      (req as Record<string, unknown>).deprecated_at = now;
      saveSpec(fugueDir, req);
      deprecated++;
    }
  }

  return textResult({ confirmed, deprecated });
}

function handleTaskNew(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const title = args.title as string;
  const requester = args.requester as string | undefined;

  const taskId = nextTaskId(fugueDir);
  const now = new Date().toISOString();

  const task: TaskData = {
    id: taskId,
    title,
    requester,
    assignees: [],
    status: 'DRAFT',
    created_at: now,
    updated_at: now,
    req_ids: [],
    escalations: [],
  };

  saveTask(fugueDir, task);

  return textResult({ taskId });
}

function handleTaskList(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  let tasks = loadTasks(fugueDir);

  const statusFilter = args.status as string | undefined;
  if (statusFilter) {
    tasks = tasks.filter((t) => t.status === statusFilter.toUpperCase());
  }

  return textResult({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      reqCount: t.req_ids.length,
      requester: t.requester ?? null,
      assignee: t.assignees.length > 0 ? t.assignees.join(', ') : null,
    })),
  });
}

function handleDiagnose(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const config = loadConfig(fugueDir);
  const root = path.dirname(fugueDir);
  const reqs = loadSpecs(fugueDir);
  const agents = loadAgentDefs(fugueDir);

  // Count tasks
  const tasksDir = path.join(fugueDir, 'tasks');
  const taskCount = fs.existsSync(tasksDir)
    ? fs.readdirSync(tasksDir).filter((f) => f.endsWith('.yaml')).length
    : 0;

  // Count LOC
  const includes = config.scan?.include ?? ['**/*.py', '**/*.ts', '**/*.js'];
  const excludes = config.scan?.exclude ?? [];
  const loc = countLoc(root, includes, excludes);

  // Count files (approximate)
  const fileCount = includes.length;

  const result = diagnoseSize({
    reqs: reqs.length,
    loc,
    files: fileCount,
    agents: agents.length,
    tasks: taskCount,
  });

  return textResult({
    size: result.size,
    reason: result.reason,
    methodology: result.methodology,
    metrics: result.metrics,
  });
}

function handleGate(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const reqs = loadSpecs(fugueDir);
  const phase = (args.phase as number) ?? 1;

  const total = reqs.length;
  const confirmed = reqs.filter((r) => ['CONFIRMED', 'DEV', 'DONE'].includes(r.status)).length;
  const done = reqs.filter((r) => r.status === 'DONE').length;
  const draft = reqs.filter((r) => r.status === 'DRAFT').length;
  const withTests = reqs.filter((r) => r.test_refs && r.test_refs.length > 0).length;
  const withCode = reqs.filter((r) => r.code_refs && r.code_refs.length > 0).length;

  const items: Array<{ name: string; score: number; max: number; status: string }> = [];

  if (phase === 1) {
    const undecidedScore = draft === 0 ? 25 : Math.round((1 - draft / total) * 25);
    items.push({ name: 'UNDECIDED/DRAFT resolved', score: undecidedScore, max: 25, status: draft === 0 ? 'PASS' : `${draft} remaining` });

    const specScore = total > 0 ? Math.round((confirmed / total) * 30) : 0;
    items.push({ name: 'Spec coverage', score: specScore, max: 30, status: `${confirmed}/${total}` });

    const codeScore = total > 0 ? Math.round((withCode / total) * 25) : 0;
    items.push({ name: 'Code mapping', score: codeScore, max: 25, status: `${withCode}/${total}` });

    const testScore = total > 0 ? Math.round((withTests / total) * 20) : 0;
    items.push({ name: 'Test coverage', score: testScore, max: 20, status: `${withTests}/${total}` });
  } else {
    const doneScore = total > 0 ? Math.round((done / total) * 25) : 0;
    items.push({ name: 'Implementation complete', score: doneScore, max: 25, status: `${done}/${total}` });

    const testScore = total > 0 ? Math.round((withTests / total) * 25) : 0;
    items.push({ name: 'Test coverage', score: testScore, max: 25, status: `${withTests}/${total}` });

    const codeScore = total > 0 ? Math.round((withCode / total) * 25) : 0;
    items.push({ name: 'Code traceability', score: codeScore, max: 25, status: `${withCode}/${total}` });

    items.push({ name: 'Escalations resolved', score: 25, max: 25, status: 'OK' });
  }

  const score = items.reduce((sum, i) => sum + i.score, 0);

  let gate: string;
  if (score >= 80 && draft === 0) {
    gate = 'PASS';
  } else if (score >= 60) {
    gate = 'CONDITIONAL PASS';
  } else {
    gate = 'FAIL';
  }

  return textResult({ score, items, gate });
}

function handleReport(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const config = loadConfig(fugueDir);
  const reqs = loadSpecs(fugueDir);
  const matrix = loadMatrix(fugueDir);
  const counts = countByStatus(reqs);
  const coverage = getMatrixCoverage(matrix);

  const date = new Date().toISOString().slice(0, 10);
  const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

  // Generate a simple markdown report (lighter than the full HTML from CLI)
  const lines: string[] = [
    `# Fugue Progress Report — ${config.project_name}`,
    '',
    `Date: ${date}`,
    '',
    `## Summary`,
    '',
    `- Progress: ${pct}% (${counts.done}/${counts.total} REQs done)`,
    `- Code mapped: ${coverage.codeMapped}/${coverage.total}`,
    `- Tests mapped: ${coverage.testMapped}/${coverage.total}`,
    `- Stale: ${counts.stale}`,
    '',
    `## Status Breakdown`,
    '',
    `| Status | Count |`,
    `|--------|-------|`,
    `| DONE | ${counts.done} |`,
    `| DEV | ${counts.dev} |`,
    `| CONFIRMED | ${counts.confirmed} |`,
    `| DRAFT | ${counts.draft} |`,
    `| STALE | ${counts.stale} |`,
    `| DEPRECATED | ${counts.deprecated} |`,
    '',
    `## Requirements`,
    '',
    `| ID | Status | Priority | Title |`,
    `|----|--------|----------|-------|`,
    ...reqs.map((r) => `| ${r.id} | ${r.status} | ${r.priority} | ${r.title} |`),
    '',
    `---`,
    `Generated by fugue MCP v0.6.0`,
  ];

  const reportContent = lines.join('\n');
  const reportsDir = path.join(fugueDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `${date}-progress.md`);
  fs.writeFileSync(reportPath, reportContent, 'utf-8');

  return textResult({ reportPath });
}

function handleSnapshotScan(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const config = loadConfig(fugueDir);
  const root = path.dirname(fugueDir);

  const includes = config.scan?.include ?? ['**/*.py', '**/*.ts', '**/*.js'];
  const excludes = config.scan?.exclude ?? [];

  const MAX_FILE_SIZE = 50_000;
  const PREVIEW_LINES = 30;

  const files: Array<{ path: string; preview: string; lines: number }> = [];

  function scanDir(dir: string, patterns: string[], excludePatterns: string[]): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full);

        if (entry.isDirectory()) {
          if (!excludePatterns.some((ex) => minimatch(rel, ex) || minimatch(rel + '/', ex))) {
            scanDir(full, patterns, excludePatterns);
          }
        } else if (entry.isFile()) {
          if (excludePatterns.some((ex) => minimatch(rel, ex))) continue;

          // Check if file matches any include pattern (match basename against simplified glob)
          const matches = patterns.some((pat) => {
            const simplified = pat.replace('**/', '');
            return minimatch(entry.name, simplified);
          });

          if (!matches) continue;

          try {
            const stat = fs.statSync(full);
            if (stat.size > MAX_FILE_SIZE) continue;

            const content = fs.readFileSync(full, 'utf-8');
            const allLines = content.split('\n');
            const preview = allLines.slice(0, PREVIEW_LINES).join('\n');

            files.push({
              path: rel,
              preview,
              lines: allLines.length,
            });
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // permission error
    }
  }

  scanDir(root, includes, excludes);
  files.sort((a, b) => a.path.localeCompare(b.path));

  return textResult({ files, total: files.length });
}

function handleSnapshotSave(args: Record<string, unknown>): ToolResult {
  const fugueDir = resolveFugueDir(args.path as string | undefined);
  const reqInputs = args.reqs as Array<{
    id: string;
    title: string;
    priority: string;
    description: string;
    code_refs?: string[];
    domain?: string;
  }>;

  if (!Array.isArray(reqInputs) || reqInputs.length === 0) {
    return errorResult('reqs must be a non-empty array');
  }

  const now = new Date().toISOString();

  // Save each req to staging
  for (const raw of reqInputs) {
    const req: ReqSpec = {
      id: raw.id,
      title: raw.title,
      priority: raw.priority,
      description: raw.description,
      status: 'DRAFT',
      created: now,
      code_refs: raw.code_refs ?? [],
      test_refs: [],
      assigned_model: raw.domain,
    };
    saveStagingSpec(fugueDir, req);
  }

  // Save staging meta
  const meta: StagingMeta = {
    timestamp: now,
    conductor: 'mcp-host',
    model_assignments: [],
    total_reqs: reqInputs.length,
  };
  saveStagingMeta(fugueDir, meta);

  // Save agent definitions if provided
  const agentInputs = args.agents as Array<{ name: string; type: string; scope: string }> | undefined;
  if (agentInputs && Array.isArray(agentInputs)) {
    for (const agent of agentInputs) {
      const def: AgentDefinition = {
        name: agent.name,
        type: agent.type,
        scope: agent.scope,
        assigned_model: 'mcp-host',
        created_at: now,
      };
      saveAgentDef(fugueDir, def);
    }
  }

  return textResult({ saved: reqInputs.length, staging: true });
}
