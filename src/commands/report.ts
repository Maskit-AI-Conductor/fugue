/**
 * fugue report — Generate HTML progress report.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  requireFugueDir,
  loadConfig,
  loadSpecs,
  loadMatrix,
  type ReqSpec,
} from '../core/project.js';
import { countByStatus } from '../core/requirements.js';
import { getMatrixCoverage } from '../core/matrix.js';
import { buildDeliverables } from '../core/deliverables.js';
import { printSuccess, printError } from '../utils/display.js';
import { emitEvent } from '../notifications/index.js';

/** Derive a domain string from a REQ spec. Priority: ID prefix > source file > code_refs > model */
function deriveDomain(req: ReqSpec): string {
  // 1. Extract from REQ ID prefix (e.g. REQ-CORE-001 → CORE)
  const idMatch = req.id.match(/^REQ-([A-Z]+)-\d+/);
  if (idMatch) return idMatch[1];

  // 2. Extract from source file name (e.g. 01-core-identity.md → core-identity)
  const source = (req.source as Record<string, string>)?.file ?? '';
  if (source) {
    const basename = source.replace(/.*\//, '').replace(/\.md$/, '').replace(/^\d+-/, '').replace(/_.*$/, '');
    if (basename) return basename;
  }

  // 3. From code_refs path
  if (req.code_refs && req.code_refs.length > 0) {
    const first = req.code_refs[0];
    const parts = first.replace(/^\//, '').split('/');
    if (parts.length > 1) return parts[0];
  }

  // 4. From assigned model
  if (req.assigned_model) return req.assigned_model;

  return 'unassigned';
}

/** Escape HTML special characters */
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const reportCommand = new Command('report')
  .description('Generate HTML progress report')
  .action(async () => {
    try {
      const fugueDir = requireFugueDir();
      const config = loadConfig(fugueDir);
      const reqs = loadSpecs(fugueDir);
      const matrix = loadMatrix(fugueDir);
      const counts = countByStatus(reqs);
      const coverage = getMatrixCoverage(matrix);
      const deliverables = buildDeliverables(fugueDir, config, reqs, matrix);

      const date = new Date().toISOString().slice(0, 10);
      const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;

      // Compute domain/priority/status statistics
      const domainMap = new Map<string, number>();
      const priorityMap = new Map<string, number>();
      const statusMap = new Map<string, number>();

      for (const r of reqs) {
        const domain = deriveDomain(r);
        domainMap.set(domain, (domainMap.get(domain) ?? 0) + 1);
        priorityMap.set(r.priority, (priorityMap.get(r.priority) ?? 0) + 1);
        statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + 1);
      }

      // Build domains list
      const domains = [...domainMap.keys()].sort();
      // Build priorities / statuses
      const priorities = ['HIGH', 'MEDIUM', 'LOW'];
      const statuses = ['DRAFT', 'CONFIRMED', 'DEV', 'DONE', 'STALE', 'DEPRECATED'];

      // Serialize REQ data for JS usage
      const reqDataJson = JSON.stringify(reqs.map((r) => ({
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
        yamlPath: `.fugue/specs/${r.id}.yaml`,
      })));

      // Build priority distribution bars data
      const maxPrioCount = Math.max(...[...priorityMap.values()], 1);

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>fugue Report — ${escHtml(config.project_name)} (${date})</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1000px; margin: 40px auto; padding: 0 20px; color: #333; background: #fafafa; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #888; margin-bottom: 24px; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card h2 { font-size: 1.1rem; margin-bottom: 12px; color: #555; }
    .progress-bar { background: #e5e5e5; border-radius: 4px; height: 24px; overflow: hidden; margin-bottom: 8px; }
    .progress-fill { background: #22c55e; height: 100%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8rem; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th { text-align: left; padding: 8px; border-bottom: 2px solid #e5e5e5; color: #888; font-weight: 600; }
    td { padding: 8px; border-bottom: 1px solid #f0f0f0; }
    .status { font-weight: 600; font-size: 0.8rem; text-transform: uppercase; }
    .status-done { color: #22c55e; }
    .status-dev { color: #eab308; }
    .status-confirmed { color: #3b82f6; }
    .status-draft { color: #999; }
    .status-stale { color: #ef4444; }
    .status-deprecated { color: #999; text-decoration: line-through; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; }
    .metric { text-align: center; }
    .metric .value { font-size: 2rem; font-weight: 700; color: #111; }
    .metric .label { font-size: 0.8rem; color: #888; }
    .del-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .del-icon { width: 20px; text-align: center; }
    .del-id { color: #3b82f6; font-weight: 600; width: 40px; }
    .del-name { flex: 1; }
    .del-detail { color: #888; font-size: 0.85rem; }
    footer { text-align: center; color: #aaa; font-size: 0.8rem; margin-top: 40px; padding: 20px 0; }

    /* Filters */
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center; }
    .filter-group { display: flex; gap: 4px; align-items: center; }
    .filter-group label { font-size: 0.8rem; color: #888; margin-right: 4px; font-weight: 600; }
    .filter-btn { padding: 4px 10px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; font-size: 0.8rem; transition: all 0.15s; }
    .filter-btn:hover { border-color: #999; }
    .filter-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
    .filter-btn.active-high { background: #ef4444; color: white; border-color: #ef4444; }
    .filter-btn.active-medium { background: #eab308; color: white; border-color: #eab308; }
    .filter-btn.active-low { background: #999; color: white; border-color: #999; }
    .search-box { padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; width: 220px; }
    .search-box:focus { outline: none; border-color: #3b82f6; }
    select.domain-select { padding: 5px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; background: white; }

    /* Stats bars */
    .stat-bars { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .stat-bar-row { display: flex; align-items: center; gap: 8px; }
    .stat-bar-label { width: 80px; font-size: 0.8rem; color: #666; text-align: right; }
    .stat-bar-track { flex: 1; background: #e5e5e5; border-radius: 3px; height: 16px; overflow: hidden; }
    .stat-bar-fill { height: 100%; border-radius: 3px; display: flex; align-items: center; padding-left: 6px; font-size: 0.7rem; color: white; font-weight: 600; }
    .stat-bar-count { width: 30px; font-size: 0.8rem; color: #888; }

    /* Collapsible */
    .req-row { cursor: pointer; user-select: none; }
    .req-row:hover { background: #f8f8f8; }
    .req-detail { display: none; }
    .req-detail.open { display: table-row; }
    .req-detail td { padding: 12px 20px; background: #f9fafb; border-bottom: 1px solid #e5e5e5; }
    .detail-grid { display: grid; grid-template-columns: 120px 1fr; gap: 6px 12px; font-size: 0.85rem; }
    .detail-label { color: #888; font-weight: 600; }
    .detail-value { color: #333; word-break: break-all; }
    .detail-value code { background: #e5e7eb; padding: 1px 4px; border-radius: 2px; font-size: 0.8rem; }
    .chevron { display: inline-block; transition: transform 0.15s; font-size: 0.7rem; margin-right: 4px; }
    .chevron.open { transform: rotate(90deg); }

    /* Pagination */
    .pagination { display: flex; justify-content: center; gap: 4px; margin-top: 12px; align-items: center; }
    .page-btn { padding: 4px 10px; border: 1px solid #ddd; border-radius: 4px; background: white; cursor: pointer; font-size: 0.8rem; }
    .page-btn:hover { border-color: #999; }
    .page-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
    .page-btn:disabled { opacity: 0.4; cursor: default; }
    .page-info { font-size: 0.8rem; color: #888; margin: 0 8px; }

    /* Count badge */
    .count-badge { display: inline-block; background: #e5e7eb; color: #555; font-size: 0.75rem; padding: 1px 6px; border-radius: 10px; margin-left: 4px; }
  </style>
</head>
<body>
  <h1>${escHtml(config.project_name)}</h1>
  <div class="subtitle">fugue Report — Generated ${date}</div>

  <div class="card">
    <h2>Progress</h2>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${pct}%">${pct}%</div>
    </div>
    <div class="grid" style="margin-top: 16px;">
      <div class="metric"><div class="value">${counts.done}/${counts.total}</div><div class="label">REQs Done</div></div>
      <div class="metric"><div class="value">${coverage.codeMapped}/${coverage.total}</div><div class="label">Code Mapped</div></div>
      <div class="metric"><div class="value">${coverage.testMapped}/${coverage.total}</div><div class="label">Tests Mapped</div></div>
      <div class="metric"><div class="value">${counts.stale}</div><div class="label">Stale</div></div>
    </div>
  </div>

  <!-- Statistics -->
  <div class="card">
    <h2>Statistics</h2>
    <div class="grid">
      <div>
        <h3 style="font-size:0.9rem; color:#666; margin-bottom:6px;">Priority Distribution</h3>
        <div class="stat-bars">
          ${priorities.map(p => {
            const cnt = priorityMap.get(p) ?? 0;
            const pctBar = maxPrioCount > 0 ? Math.round((cnt / maxPrioCount) * 100) : 0;
            const colors: Record<string, string> = { HIGH: '#ef4444', MEDIUM: '#eab308', LOW: '#999' };
            return `<div class="stat-bar-row"><span class="stat-bar-label">${p}</span><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pctBar}%; background:${colors[p] ?? '#999'}">${cnt > 0 ? cnt : ''}</div></div><span class="stat-bar-count">${cnt}</span></div>`;
          }).join('\n          ')}
        </div>
      </div>
      <div>
        <h3 style="font-size:0.9rem; color:#666; margin-bottom:6px;">Domain Distribution</h3>
        <div class="stat-bars">
          ${domains.map(d => {
            const cnt = domainMap.get(d) ?? 0;
            const pctBar = counts.total > 0 ? Math.round((cnt / counts.total) * 100) : 0;
            return `<div class="stat-bar-row"><span class="stat-bar-label" title="${escHtml(d)}">${escHtml(d.length > 10 ? d.slice(0, 9) + '\u2026' : d)}</span><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${pctBar}%; background:#3b82f6">${cnt > 0 ? cnt : ''}</div></div><span class="stat-bar-count">${cnt}</span></div>`;
          }).join('\n          ')}
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Deliverables</h2>
    ${Object.entries(deliverables).map(([id, d]) => {
      const iconMap: Record<string, string> = { done: '\u2713', wip: '\u25C9', warn: '\u25B3', pending: '\u25CB', stale: '!' };
      return `<div class="del-row"><span class="del-icon">${iconMap[d.icon] ?? '\u25CB'}</span><span class="del-id">${id}</span><span class="del-name">${escHtml(d.name)}</span><span class="del-detail">${escHtml(d.detail)}</span></div>`;
    }).join('\n    ')}
  </div>

  <div class="card">
    <h2>Requirements <span id="reqCount" class="count-badge">${counts.total}</span></h2>

    <!-- Filters -->
    <div class="filters">
      <div class="filter-group">
        <label>Domain:</label>
        <select class="domain-select" id="domainFilter" onchange="applyFilters()">
          <option value="">All</option>
          ${domains.map(d => `<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('\n          ')}
        </select>
      </div>
      <div class="filter-group">
        <label>Priority:</label>
        ${priorities.map(p => `<button class="filter-btn" data-filter="priority" data-value="${p}" onclick="toggleFilter(this)">${p}</button>`).join('\n        ')}
      </div>
      <div class="filter-group">
        <label>Status:</label>
        ${statuses.map(s => `<button class="filter-btn" data-filter="status" data-value="${s}" onclick="toggleFilter(this)">${s}</button>`).join('\n        ')}
      </div>
      <div class="filter-group" style="margin-left:auto;">
        <input type="text" class="search-box" id="searchBox" placeholder="Search REQ ID or title..." oninput="applyFilters()">
      </div>
    </div>

    <table>
      <thead><tr><th></th><th>ID</th><th>Status</th><th>Priority</th><th>Title</th></tr></thead>
      <tbody id="reqTableBody">
      </tbody>
    </table>
    <div class="pagination" id="pagination"></div>
  </div>

  <footer>Generated by fugue v0.2.0 — Fugue</footer>

  <script>
  (function() {
    var ALL_REQS = ${reqDataJson};
    var PAGE_SIZE = 50;
    var currentPage = 1;
    var filteredReqs = ALL_REQS.slice();
    var openDetails = {};

    var activePriorities = {};
    var activeStatuses = {};

    window.toggleFilter = function(btn) {
      var filter = btn.getAttribute('data-filter');
      var value = btn.getAttribute('data-value');
      var map = filter === 'priority' ? activePriorities : activeStatuses;

      if (map[value]) {
        delete map[value];
        btn.classList.remove('active', 'active-high', 'active-medium', 'active-low');
      } else {
        map[value] = true;
        if (filter === 'priority') {
          btn.classList.add('active-' + value.toLowerCase());
        } else {
          btn.classList.add('active');
        }
      }
      applyFilters();
    };

    window.applyFilters = function() {
      var domain = document.getElementById('domainFilter').value;
      var search = document.getElementById('searchBox').value.toLowerCase().trim();
      var prioKeys = Object.keys(activePriorities);
      var statusKeys = Object.keys(activeStatuses);

      filteredReqs = ALL_REQS.filter(function(r) {
        if (domain && r.domain !== domain) return false;
        if (prioKeys.length > 0 && !activePriorities[r.priority]) return false;
        if (statusKeys.length > 0 && !activeStatuses[r.status]) return false;
        if (search && r.id.toLowerCase().indexOf(search) === -1 && r.title.toLowerCase().indexOf(search) === -1) return false;
        return true;
      });

      currentPage = 1;
      render();
    };

    window.toggleDetail = function(id) {
      openDetails[id] = !openDetails[id];
      render();
    };

    window.goToPage = function(p) {
      currentPage = p;
      render();
    };

    function escH(s) {
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function render() {
      var total = filteredReqs.length;
      var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;

      var start = (currentPage - 1) * PAGE_SIZE;
      var pageReqs = filteredReqs.slice(start, start + PAGE_SIZE);

      document.getElementById('reqCount').textContent = total + ' / ' + ALL_REQS.length;

      var html = '';
      for (var i = 0; i < pageReqs.length; i++) {
        var r = pageReqs[i];
        var cls = 'status-' + r.status.toLowerCase();
        var isOpen = openDetails[r.id];
        html += '<tr class="req-row" onclick="toggleDetail(\\''+r.id+'\\')">';
        html += '<td><span class="chevron'+(isOpen?' open':'')+'">\\u25B6</span></td>';
        html += '<td>'+escH(r.id)+'</td>';
        html += '<td class="status '+cls+'">'+escH(r.status)+'</td>';
        html += '<td>'+escH(r.priority)+'</td>';
        html += '<td>'+escH(r.title)+'</td>';
        html += '</tr>';
        html += '<tr class="req-detail'+(isOpen?' open':'')+'">';
        html += '<td colspan="5"><div class="detail-grid">';
        html += '<span class="detail-label">Description</span><span class="detail-value">'+escH(r.description || '(none)')+'</span>';
        html += '<span class="detail-label">Created</span><span class="detail-value">'+escH(r.created || '(unknown)')+'</span>';
        html += '<span class="detail-label">Code Refs</span><span class="detail-value">'+(r.code_refs.length > 0 ? r.code_refs.map(function(c){return '<code>'+escH(c)+'</code>';}).join(' ') : '(none)')+'</span>';
        html += '<span class="detail-label">Test Refs</span><span class="detail-value">'+(r.test_refs.length > 0 ? r.test_refs.map(function(c){return '<code>'+escH(c)+'</code>';}).join(' ') : '(none)')+'</span>';
        if (r.assigned_model) html += '<span class="detail-label">Model</span><span class="detail-value">'+escH(r.assigned_model)+'</span>';
        html += '<span class="detail-label">YAML</span><span class="detail-value"><code>'+escH(r.yamlPath)+'</code></span>';
        html += '</div></td></tr>';
      }
      document.getElementById('reqTableBody').innerHTML = html;

      // Pagination
      var pagHtml = '';
      if (totalPages > 1) {
        pagHtml += '<button class="page-btn" onclick="goToPage(1)"'+(currentPage===1?' disabled':'')+'>\\u00AB</button>';
        pagHtml += '<button class="page-btn" onclick="goToPage('+(currentPage-1)+')"'+(currentPage===1?' disabled':'')+'>\\u2039</button>';

        var startP = Math.max(1, currentPage - 3);
        var endP = Math.min(totalPages, currentPage + 3);
        for (var p = startP; p <= endP; p++) {
          pagHtml += '<button class="page-btn'+(p===currentPage?' active':'')+'" onclick="goToPage('+p+')">'+p+'</button>';
        }

        pagHtml += '<button class="page-btn" onclick="goToPage('+(currentPage+1)+')"'+(currentPage===totalPages?' disabled':'')+'>\\u203A</button>';
        pagHtml += '<button class="page-btn" onclick="goToPage('+totalPages+')"'+(currentPage===totalPages?' disabled':'')+'>\\u00BB</button>';
        pagHtml += '<span class="page-info">'+start+1+'-'+Math.min(start+PAGE_SIZE,total)+' of '+total+'</span>';
      }
      document.getElementById('pagination').innerHTML = pagHtml;
    }

    render();
  })();
  </script>
</body>
</html>`;

      const reportsDir = path.join(fugueDir, 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      const reportPath = path.join(reportsDir, `${date}-progress.html`);
      fs.writeFileSync(reportPath, html, 'utf-8');

      printSuccess(`Report generated: .fugue/reports/${date}-progress.html`);
      console.log();
      console.log(`  ${chalk.cyan(`open ${reportPath}`)}`);

      // Emit notification
      await emitEvent(fugueDir, 'report.generated', `Report generated for ${config.project_name}`, {
        Project: config.project_name,
        Date: date,
        'REQs Done': `${counts.done}/${counts.total} (${pct}%)`,
      });
    } catch (err: unknown) {
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
