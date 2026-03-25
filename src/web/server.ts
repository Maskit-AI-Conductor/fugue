/**
 * HTTP server + REST API for fugue web dashboard.
 * Uses only Node.js built-in http module (no Express).
 */

import http from 'node:http';
import path from 'node:path';
import {
  loadConfig,
  loadSpecs,
  loadMatrix,
  loadTasks,
  saveSpec,
  type ReqSpec,
} from '../core/project.js';
import { countByStatus } from '../core/requirements.js';
import { getMatrixCoverage } from '../core/matrix.js';
import { buildDeliverables } from '../core/deliverables.js';
import { renderDashboard } from './dashboard.js';
import fs from 'node:fs';

// ============ Helpers ============

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function htmlResponse(res: http.ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache',
  });
  res.end(html);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/** Derive a domain string from a REQ spec (same logic as report.ts). */
function deriveDomain(req: ReqSpec): string {
  const idMatch = req.id.match(/^REQ-([A-Z]+)-\d+/);
  if (idMatch) return idMatch[1];

  const source = (req.source as Record<string, string>)?.file ?? '';
  if (source) {
    const basename = source.replace(/.*\//, '').replace(/\.md$/, '').replace(/^\d+-/, '').replace(/_.*$/, '');
    if (basename) return basename;
  }

  if (req.code_refs && req.code_refs.length > 0) {
    const parts = req.code_refs[0].replace(/^\//, '').split('/');
    if (parts.length > 1) return parts[0];
  }

  if (req.assigned_model) return String(req.assigned_model);

  return 'unassigned';
}

// ============ API Handlers ============

function handleGetStatus(fugueDir: string): unknown {
  const config = loadConfig(fugueDir);
  const reqs = loadSpecs(fugueDir);
  const matrix = loadMatrix(fugueDir);
  const counts = countByStatus(reqs);
  const coverage = getMatrixCoverage(matrix);

  return {
    project_name: config.project_name,
    conductor: config.conductor ?? null,
    conductor_name: config.conductor_name ?? null,
    counts,
    coverage: {
      code: coverage.codeMapped,
      test: coverage.testMapped,
      total: coverage.total,
    },
  };
}

function handleGetSpecs(fugueDir: string): unknown {
  const reqs = loadSpecs(fugueDir);
  return reqs.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    description: r.description ?? '',
    created: r.created ?? '',
    code_refs: r.code_refs ?? [],
    test_refs: r.test_refs ?? [],
    assigned_model: r.assigned_model ?? '',
    domain: deriveDomain(r),
    feedback: (r.feedback as Array<Record<string, string>>) ?? [],
  }));
}

function handleGetSpecById(fugueDir: string, reqId: string): unknown {
  const reqs = loadSpecs(fugueDir);
  const req = reqs.find((r) => r.id === reqId);
  if (!req) return { error: `REQ not found: ${reqId}` };
  return {
    ...req,
    domain: deriveDomain(req),
    feedback: (req.feedback as Array<Record<string, string>>) ?? [],
  };
}

function handleFeedback(
  fugueDir: string,
  reqId: string,
  body: { action: string; message?: string; from?: string },
): unknown {
  const reqs = loadSpecs(fugueDir);
  const req = reqs.find((r) => r.id === reqId);
  if (!req) return { error: `REQ not found: ${reqId}` };

  const action = body.action as 'accept' | 'reject' | 'comment';
  if (!['accept', 'reject', 'comment'].includes(action)) {
    return { error: `Invalid action: ${body.action}. Must be accept, reject, or comment.` };
  }

  if (action === 'comment' && !body.message) {
    return { error: 'message is required for comment action' };
  }

  const feedbackList = (req.feedback as Array<Record<string, string>>) ?? [];
  feedbackList.push({
    from: body.from ?? 'web-dashboard',
    action,
    message: body.message ?? (action === 'accept' ? 'Accepted' : action === 'reject' ? 'Rejected' : ''),
    at: new Date().toISOString(),
  });
  req.feedback = feedbackList;

  if (action === 'reject') {
    req.status = 'REJECTED';
  } else if (action === 'accept') {
    req.status = 'ACCEPTED';
  }

  saveSpec(fugueDir, req);
  return { success: true, reqId, newStatus: req.status };
}

function handleConfirm(fugueDir: string): unknown {
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

  return { confirmed, deprecated };
}

function handleGetTasks(fugueDir: string): unknown {
  return loadTasks(fugueDir);
}

function handleGetDeliverables(fugueDir: string): unknown {
  const config = loadConfig(fugueDir);
  const reqs = loadSpecs(fugueDir);
  const matrix = loadMatrix(fugueDir);
  return buildDeliverables(fugueDir, config, reqs, matrix);
}

function handleGetAudit(fugueDir: string): unknown {
  const reqs = loadSpecs(fugueDir);
  if (reqs.length === 0) {
    return { error: 'No requirements to audit.' };
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

  return {
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
    gate: results.stale.length > 0
      ? 'FAIL'
      : (results.warn.length > 0 || results.todo.length > 0)
        ? 'CONDITIONAL PASS'
        : 'PASS',
  };
}

// ============ Server ============

export function startServer(fugueDir: string, port: number): http.Server {
  const config = loadConfig(fugueDir);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // ---- Dashboard HTML ----
      if (pathname === '/' && method === 'GET') {
        const html = renderDashboard(config.project_name);
        htmlResponse(res, html);
        return;
      }

      // ---- API routes ----
      if (pathname === '/api/status' && method === 'GET') {
        jsonResponse(res, handleGetStatus(fugueDir));
        return;
      }

      if (pathname === '/api/specs' && method === 'GET') {
        jsonResponse(res, handleGetSpecs(fugueDir));
        return;
      }

      // GET /api/specs/:id
      const specMatch = pathname.match(/^\/api\/specs\/([^/]+)$/);
      if (specMatch && method === 'GET') {
        const result = handleGetSpecById(fugueDir, decodeURIComponent(specMatch[1]));
        jsonResponse(res, result, (result as Record<string, unknown>).error ? 404 : 200);
        return;
      }

      // POST /api/specs/:id/feedback
      const fbMatch = pathname.match(/^\/api\/specs\/([^/]+)\/feedback$/);
      if (fbMatch && method === 'POST') {
        const bodyStr = await readBody(req);
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(bodyStr);
        } catch {
          jsonResponse(res, { error: 'Invalid JSON body' }, 400);
          return;
        }
        const result = handleFeedback(
          fugueDir,
          decodeURIComponent(fbMatch[1]),
          body as { action: string; message?: string; from?: string },
        );
        jsonResponse(res, result, (result as Record<string, unknown>).error ? 400 : 200);
        return;
      }

      // POST /api/specs/:id/status
      const statusMatch = pathname.match(/^\/api\/specs\/([^/]+)\/status$/);
      if (statusMatch && method === 'POST') {
        const bodyStr = await readBody(req);
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(bodyStr);
        } catch {
          jsonResponse(res, { error: 'Invalid JSON body' }, 400);
          return;
        }
        const reqId = decodeURIComponent(statusMatch[1]);
        const newStatus = body.status as string;
        const validStatuses = ['DRAFT', 'DECOMPOSED', 'CONFIRMED', 'DEV', 'TESTING', 'DONE'];
        if (!validStatuses.includes(newStatus)) {
          jsonResponse(res, { error: `Invalid status: ${newStatus}` }, 400);
          return;
        }
        const allSpecs = loadSpecs(fugueDir);
        const targetSpec = allSpecs.find(r => r.id === reqId);
        if (!targetSpec) {
          jsonResponse(res, { error: `REQ not found: ${reqId}` }, 404);
          return;
        }
        const oldStatus = targetSpec.status;
        targetSpec.status = newStatus;
        const feedbackList = (targetSpec.feedback as Array<Record<string, string>>) ?? [];
        feedbackList.push({
          from: 'web-dashboard',
          action: 'status-change',
          message: `${oldStatus} → ${newStatus}`,
          at: new Date().toISOString(),
        });
        targetSpec.feedback = feedbackList;
        saveSpec(fugueDir, targetSpec);
        jsonResponse(res, { success: true, id: reqId, oldStatus, newStatus });
        return;
      }

      // POST /api/confirm
      if (pathname === '/api/confirm' && method === 'POST') {
        jsonResponse(res, handleConfirm(fugueDir));
        return;
      }

      if (pathname === '/api/tasks' && method === 'GET') {
        jsonResponse(res, handleGetTasks(fugueDir));
        return;
      }

      if (pathname === '/api/deliverables' && method === 'GET') {
        jsonResponse(res, handleGetDeliverables(fugueDir));
        return;
      }

      if (pathname === '/api/audit' && method === 'GET') {
        jsonResponse(res, handleGetAudit(fugueDir));
        return;
      }

      // ---- 404 ----
      jsonResponse(res, { error: 'Not found' }, 404);
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
  });

  server.listen(port, '0.0.0.0');

  return server;
}
