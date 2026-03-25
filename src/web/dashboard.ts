/**
 * Dashboard HTML generator — single-file inline CSS + JS.
 * Renders a shell HTML that fetches data from /api/* endpoints.
 *
 * Views: Board (kanban) | List | Deliverables | Tasks
 */

export function renderDashboard(projectName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>fugue — ${escHtml(projectName)}</title>
  <style>
    :root {
      --bg: #fafafa;
      --card-bg: #ffffff;
      --text: #1a1a2e;
      --text-muted: #6b7280;
      --text-dim: #9ca3af;
      --border: #e5e7eb;
      --key: #1a1a2e;
      --accent: #3b82f6;
      --green: #22c55e;
      --yellow: #eab308;
      --red: #ef4444;
      --radius: 8px;
      --shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg); color: var(--text);
      margin: 0 auto; padding: 24px 20px;
      line-height: 1.5;
    }
    body.panel-open { margin-right: 420px; }

    /* Header */
    .header { margin-bottom: 16px; max-width: 1200px; margin-left: auto; margin-right: auto; }
    .header h1 { font-size: 1.4rem; font-weight: 700; color: var(--key); }
    .header .meta { font-size: 0.85rem; color: var(--text-muted); margin-top: 2px; }
    .header .meta span { margin-right: 16px; }
    .project-label { font-size: 0.75rem; color: var(--text-dim); margin-top: 4px; }

    /* View tabs */
    .view-tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 2px solid var(--border); max-width: 1200px; margin-left: auto; margin-right: auto; }
    .view-tab {
      padding: 8px 20px; cursor: pointer; font-size: 0.9rem; font-weight: 600;
      color: var(--text-muted); border-bottom: 2px solid transparent; margin-bottom: -2px;
      background: none; border-top: none; border-left: none; border-right: none;
      transition: color 0.15s, border-color 0.15s;
    }
    .view-tab:hover { color: var(--text); }
    .view-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

    /* Cards */
    .card {
      background: var(--card-bg); border-radius: var(--radius);
      padding: 20px; margin-bottom: 16px; box-shadow: var(--shadow);
      border: 1px solid var(--border); max-width: 1200px; margin-left: auto; margin-right: auto;
    }
    .card h2 {
      font-size: 1rem; font-weight: 600; color: var(--text-muted);
      margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
    }
    .card h2 .badge {
      font-size: 0.75rem; background: var(--border); color: var(--text-muted);
      padding: 1px 8px; border-radius: 10px; font-weight: 500;
    }

    /* Stats bar */
    .stats-bar {
      background: var(--card-bg); border-radius: var(--radius);
      padding: 16px 20px; margin-bottom: 16px; box-shadow: var(--shadow);
      border: 1px solid var(--border); max-width: 1200px; margin-left: auto; margin-right: auto;
    }
    .stats-summary { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; font-size: 0.9rem; margin-bottom: 8px; }
    .stats-summary .stat-item { display: flex; align-items: center; gap: 4px; }
    .stats-summary .stat-label { color: var(--text-muted); }
    .stats-summary .stat-value { font-weight: 700; }
    .stats-summary .stat-value.done { color: var(--green); }
    .stats-summary .stat-value.dev { color: var(--yellow); }
    .stats-summary .stat-value.confirmed { color: var(--accent); }
    .stats-summary .stat-value.draft { color: var(--text-dim); }
    .stats-progress { background: var(--border); border-radius: 4px; height: 20px; overflow: hidden; }
    .stats-progress-fill {
      background: var(--green); height: 100%;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 0.75rem; font-weight: 600;
      min-width: 28px; transition: width 0.4s ease;
    }

    /* Filters — shared between board and list */
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; align-items: center; max-width: 1200px; margin-left: auto; margin-right: auto; }
    .filter-group { display: flex; gap: 4px; align-items: center; }
    .filter-group label { font-size: 0.8rem; color: var(--text-muted); margin-right: 4px; font-weight: 600; }
    .filter-btn {
      padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px;
      background: var(--card-bg); cursor: pointer; font-size: 0.8rem; transition: all 0.15s;
    }
    .filter-btn:hover { border-color: #999; }
    .filter-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
    .filter-btn.active-high { background: var(--red); color: white; border-color: var(--red); }
    .filter-btn.active-medium { background: var(--yellow); color: white; border-color: var(--yellow); }
    .filter-btn.active-low { background: var(--text-dim); color: white; border-color: var(--text-dim); }
    .search-box {
      padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px;
      font-size: 0.85rem; width: 220px; background: var(--card-bg);
    }
    .search-box:focus { outline: none; border-color: var(--accent); }
    select.filter-select {
      padding: 5px 8px; border: 1px solid var(--border); border-radius: 4px;
      font-size: 0.85rem; background: var(--card-bg);
    }

    /* Progress bar (list view) */
    .progress-bar { background: var(--border); border-radius: 4px; height: 24px; overflow: hidden; margin-bottom: 12px; }
    .progress-fill {
      background: var(--green); height: 100%;
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 0.8rem; font-weight: 600;
      min-width: 32px; transition: width 0.4s ease;
    }

    /* Status counters */
    .counters { display: flex; flex-wrap: wrap; gap: 16px; }
    .counter { text-align: center; min-width: 80px; }
    .counter .value { font-size: 1.6rem; font-weight: 700; }
    .counter .label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
    .counter.done .value { color: var(--green); }
    .counter.dev .value { color: var(--yellow); }
    .counter.confirmed .value { color: var(--accent); }
    .counter.draft .value { color: var(--text-dim); }
    .counter.stale .value { color: var(--red); }
    .counter.deprecated .value { color: var(--text-dim); text-decoration: line-through; }

    /* Kanban board */
    .kanban-container { max-width: 100%; overflow-x: auto; padding-bottom: 8px; }
    .kanban {
      display: grid;
      grid-template-columns: repeat(6, minmax(200px, 1fr));
      gap: 8px;
      min-width: 900px;
    }
    .kanban-column {
      background: #f0f1f3;
      border-radius: 8px;
      padding: 8px;
      min-height: 200px;
    }
    .kanban-column-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 8px; margin-bottom: 8px;
      font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
      color: var(--text-muted);
    }
    .kanban-column-count {
      background: var(--border); color: var(--text-muted);
      padding: 1px 8px; border-radius: 10px; font-size: 0.7rem; font-weight: 600;
    }
    .kanban-cards { display: flex; flex-direction: column; gap: 6px; }
    .kanban-card {
      background: white;
      border-radius: 6px;
      padding: 8px 12px;
      border-left: 3px solid;
      cursor: pointer;
      font-size: 13px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.06);
      transition: box-shadow 0.15s, transform 0.1s;
    }
    .kanban-card:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.12); transform: translateY(-1px); }
    .kanban-card.high { border-color: var(--red); }
    .kanban-card.medium { border-color: var(--yellow); }
    .kanban-card.low { border-color: var(--text-dim); }
    .kanban-card-id { font-size: 0.75rem; color: var(--accent); font-weight: 600; }
    .kanban-card-title { margin-top: 2px; color: var(--text); line-height: 1.3; word-break: break-word; }
    .kanban-card-meta { margin-top: 4px; display: flex; gap: 6px; align-items: center; font-size: 0.7rem; }
    .kanban-card-priority { font-weight: 700; text-transform: uppercase; }
    .kanban-card-priority.high { color: var(--red); }
    .kanban-card-priority.medium { color: var(--yellow); }
    .kanban-card-priority.low { color: var(--text-dim); }
    .kanban-card-assignee { color: var(--text-muted); }

    /* Detail panel (side panel) */
    .detail-panel {
      position: fixed;
      right: 0; top: 0;
      width: 420px; height: 100vh;
      background: white;
      box-shadow: -2px 0 10px rgba(0,0,0,0.1);
      transform: translateX(100%);
      transition: transform 0.2s;
      overflow-y: auto;
      z-index: 100;
      border-left: 1px solid var(--border);
    }
    .detail-panel.open { transform: translateX(0); }
    .detail-panel-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: white; z-index: 1;
    }
    .detail-panel-header h3 { font-size: 1rem; font-weight: 700; color: var(--accent); }
    .detail-panel-close {
      background: none; border: none; font-size: 1.4rem; cursor: pointer;
      color: var(--text-muted); padding: 4px 8px; border-radius: 4px;
    }
    .detail-panel-close:hover { background: var(--border); }
    .detail-panel-body { padding: 16px 20px; }
    .detail-panel-body .dp-title { font-size: 1.1rem; font-weight: 600; margin-bottom: 12px; }
    .dp-field { margin-bottom: 10px; }
    .dp-field-label { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 2px; }
    .dp-field-value { font-size: 0.9rem; color: var(--text); word-break: break-word; }
    .dp-field-value code { background: #e5e7eb; padding: 1px 5px; border-radius: 3px; font-size: 0.8rem; }
    .dp-badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px;
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    }
    .dp-badge.status-draft { background: #f3f4f6; color: var(--text-dim); }
    .dp-badge.status-decomposed { background: #ede9fe; color: #7c3aed; }
    .dp-badge.status-confirmed { background: #dbeafe; color: var(--accent); }
    .dp-badge.status-dev { background: #fef3c7; color: #b45309; }
    .dp-badge.status-testing { background: #e0f2fe; color: #0284c7; }
    .dp-badge.status-done { background: #dcfce7; color: #16a34a; }
    .dp-badge.status-accepted { background: #dcfce7; color: #059669; }
    .dp-badge.status-rejected { background: #fee2e2; color: var(--red); }
    .dp-badge.status-stale { background: #fee2e2; color: var(--red); }
    .dp-badge.status-deprecated { background: #f3f4f6; color: var(--text-dim); text-decoration: line-through; }
    .dp-badge.priority-high { background: #fee2e2; color: var(--red); }
    .dp-badge.priority-medium { background: #fef3c7; color: #b45309; }
    .dp-badge.priority-low { background: #f3f4f6; color: var(--text-dim); }
    .dp-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
    .dp-section h4 { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
    .dp-fb-entry { font-size: 0.8rem; padding: 4px 0; color: var(--text-muted); }
    .dp-fb-entry .fb-action { font-weight: 600; text-transform: uppercase; }
    .dp-fb-entry .fb-action.accept { color: var(--green); }
    .dp-fb-entry .fb-action.reject { color: var(--red); }
    .dp-fb-entry .fb-action.comment { color: var(--accent); }
    .dp-feedback-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .dp-feedback-form input {
      padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; font-size: 0.85rem;
    }
    .dp-feedback-form input:focus { outline: none; border-color: var(--accent); }
    .dp-feedback-btns { display: flex; gap: 6px; }
    .dp-fb-btn {
      padding: 5px 14px; border: 1px solid var(--border); border-radius: 4px;
      cursor: pointer; font-size: 0.8rem; font-weight: 600; transition: all 0.15s;
      background: var(--card-bg);
    }
    .dp-fb-btn:hover { opacity: 0.85; }
    .dp-fb-btn.accept { background: var(--green); color: white; border-color: var(--green); }
    .dp-fb-btn.reject { background: var(--red); color: white; border-color: var(--red); }
    .dp-fb-btn.comment-btn { background: var(--accent); color: white; border-color: var(--accent); }

    /* Deliverables */
    .del-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 0.9rem; }
    .del-icon { width: 20px; text-align: center; font-size: 0.85rem; }
    .del-icon.done { color: var(--green); }
    .del-icon.wip { color: var(--yellow); }
    .del-icon.warn { color: var(--yellow); }
    .del-icon.pending { color: var(--text-dim); }
    .del-id { font-weight: 600; color: var(--accent); width: 40px; }
    .del-name { flex: 1; }
    .del-detail { color: var(--text-muted); font-size: 0.85rem; }

    /* REQ Table (list view) */
    .req-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    .req-table th { text-align: left; padding: 8px; border-bottom: 2px solid var(--border); color: var(--text-muted); font-weight: 600; font-size: 0.8rem; }
    .req-table td { padding: 8px; border-bottom: 1px solid #f0f0f0; }
    .req-row { cursor: pointer; user-select: none; }
    .req-row:hover { background: #f8f9fa; }
    .status { font-weight: 600; font-size: 0.8rem; text-transform: uppercase; }
    .status-done { color: var(--green); }
    .status-dev { color: var(--yellow); }
    .status-confirmed { color: var(--accent); }
    .status-draft { color: var(--text-dim); }
    .status-stale { color: var(--red); }
    .status-deprecated { color: var(--text-dim); text-decoration: line-through; }
    .status-accepted { color: #059669; }
    .status-rejected { color: var(--red); }
    .priority-high { color: var(--red); font-weight: 600; }
    .priority-medium { color: var(--yellow); font-weight: 600; }
    .priority-low { color: var(--text-dim); }

    /* Detail row (list view) */
    .req-detail { display: none; }
    .req-detail.open { display: table-row; }
    .req-detail td { padding: 14px 20px; background: #f9fafb; border-bottom: 1px solid var(--border); }
    .detail-grid { display: grid; grid-template-columns: 110px 1fr; gap: 6px 12px; font-size: 0.85rem; }
    .detail-label { color: var(--text-muted); font-weight: 600; }
    .detail-value { color: var(--text); word-break: break-word; }
    .detail-value code { background: #e5e7eb; padding: 1px 5px; border-radius: 3px; font-size: 0.8rem; }
    .chevron { display: inline-block; transition: transform 0.15s; font-size: 0.7rem; margin-right: 4px; }
    .chevron.open { transform: rotate(90deg); }

    /* Feedback section (list view) */
    .feedback-section { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    .feedback-history { margin-bottom: 10px; }
    .fb-entry { font-size: 0.8rem; padding: 4px 0; color: var(--text-muted); }
    .fb-entry .fb-action { font-weight: 600; text-transform: uppercase; }
    .fb-entry .fb-action.accept { color: var(--green); }
    .fb-entry .fb-action.reject { color: var(--red); }
    .fb-entry .fb-action.comment { color: var(--accent); }
    .feedback-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .fb-btn {
      padding: 5px 14px; border: 1px solid var(--border); border-radius: 4px;
      cursor: pointer; font-size: 0.8rem; font-weight: 600; transition: all 0.15s;
      background: var(--card-bg);
    }
    .fb-btn:hover { opacity: 0.85; }
    .fb-btn.accept { background: var(--green); color: white; border-color: var(--green); }
    .fb-btn.reject { background: var(--red); color: white; border-color: var(--red); }
    .fb-btn.comment-btn { background: var(--accent); color: white; border-color: var(--accent); }
    .fb-input {
      flex: 1; min-width: 200px; padding: 5px 10px;
      border: 1px solid var(--border); border-radius: 4px; font-size: 0.85rem;
    }
    .fb-input:focus { outline: none; border-color: var(--accent); }
    .fb-from {
      width: 100px; padding: 5px 8px;
      border: 1px solid var(--border); border-radius: 4px; font-size: 0.85rem;
    }

    /* Confirm button */
    .confirm-section { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
    .confirm-btn {
      padding: 8px 20px; border: none; border-radius: 4px;
      cursor: pointer; font-size: 0.85rem; font-weight: 600;
      background: var(--key); color: white; transition: opacity 0.15s;
    }
    .confirm-btn:hover { opacity: 0.85; }
    .confirm-btn:disabled { opacity: 0.4; cursor: default; }
    .confirm-result { font-size: 0.85rem; color: var(--green); }

    /* Pagination */
    .pagination { display: flex; justify-content: center; gap: 4px; margin-top: 12px; align-items: center; }
    .page-btn {
      padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px;
      background: var(--card-bg); cursor: pointer; font-size: 0.8rem;
    }
    .page-btn:hover { border-color: #999; }
    .page-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
    .page-btn:disabled { opacity: 0.4; cursor: default; }
    .page-info { font-size: 0.8rem; color: var(--text-muted); margin: 0 8px; }

    /* Tasks */
    .task-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 0.9rem; border-bottom: 1px solid #f0f0f0; }
    .task-id { font-weight: 600; color: var(--accent); width: 80px; }
    .task-status { width: 90px; }
    .task-title { flex: 1; }
    .task-reqs { color: var(--text-muted); font-size: 0.85rem; }

    /* Toast */
    .toast {
      position: fixed; bottom: 20px; right: 20px;
      background: var(--key); color: white; padding: 10px 20px;
      border-radius: var(--radius); font-size: 0.85rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 1000;
    }
    .toast.show { opacity: 1; }

    /* Overlay for detail panel */
    .panel-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.15); z-index: 99;
    }
    .panel-overlay.open { display: block; }

    /* View sections */
    .view-section { display: none; }
    .view-section.active { display: block; }

    /* Responsive */
    @media (max-width: 768px) {
      body { padding: 12px; }
      body.panel-open { margin-right: 0; }
      .filters { flex-direction: column; align-items: stretch; }
      .search-box { width: 100%; }
      .counters { justify-content: space-around; }
      .feedback-actions { flex-direction: column; }
      .fb-input { min-width: auto; width: 100%; }
      .detail-panel { width: 100%; }
      .kanban { grid-template-columns: repeat(6, minmax(180px, 1fr)); min-width: 800px; }
    }

    /* Refresh indicator */
    .refresh-dot {
      display: inline-block; width: 8px; height: 8px; border-radius: 50%;
      background: var(--green); margin-left: 8px; vertical-align: middle;
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

    .loading { text-align: center; padding: 40px; color: var(--text-muted); }
  </style>
</head>
<body>
  <div class="header">
    <h1>fugue — Project Dashboard <span class="refresh-dot" title="Auto-refreshing"></span></h1>
    <div class="meta" id="headerMeta">Loading...</div>
    <div class="project-label" id="projectLabel"></div>
  </div>

  <!-- View Tabs -->
  <div class="view-tabs" id="viewTabs">
    <button class="view-tab active" data-view="board">Board</button>
    <button class="view-tab" data-view="list">List</button>
    <button class="view-tab" data-view="deliverables">Deliverables</button>
    <button class="view-tab" data-view="tasks">Tasks</button>
  </div>

  <!-- ========== BOARD VIEW ========== -->
  <div class="view-section active" id="view-board">
    <!-- Stats bar -->
    <div class="stats-bar" id="statsBar">
      <div class="stats-summary" id="statsSummary"></div>
      <div class="stats-progress"><div class="stats-progress-fill" id="statsProgressFill" style="width:0%">0%</div></div>
    </div>

    <!-- Filters -->
    <div class="filters" id="boardFilters">
      <div class="filter-group">
        <label>Domain:</label>
        <select class="filter-select" id="boardDomainFilter"><option value="">All</option></select>
      </div>
      <div class="filter-group">
        <label>Assignee:</label>
        <select class="filter-select" id="boardAssigneeFilter"><option value="">All</option><option value="__unassigned__">Unassigned</option></select>
      </div>
      <div class="filter-group">
        <label>Priority:</label>
        <button class="filter-btn" data-board-filter="priority" data-value="ALL">ALL</button>
        <button class="filter-btn" data-board-filter="priority" data-value="HIGH">HIGH</button>
        <button class="filter-btn" data-board-filter="priority" data-value="MEDIUM">MEDIUM</button>
        <button class="filter-btn" data-board-filter="priority" data-value="LOW">LOW</button>
      </div>
      <div class="filter-group">
        <label>Requester:</label>
        <select class="filter-select" id="boardRequesterFilter"><option value="">All</option></select>
      </div>
      <div class="filter-group" style="margin-left:auto;">
        <input type="text" class="search-box" id="boardSearchBox" placeholder="Search REQ ID or title...">
      </div>
    </div>

    <!-- Kanban board -->
    <div class="kanban-container">
      <div class="kanban" id="kanbanBoard"></div>
    </div>
  </div>

  <!-- ========== LIST VIEW ========== -->
  <div class="view-section" id="view-list">
    <div class="card" id="progressCard">
      <h2>Progress</h2>
      <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%">0%</div></div>
      <div class="counters" id="counters"></div>
    </div>

    <div class="card" id="reqsCard">
      <h2>Requirements <span class="badge" id="reqCount">0</span></h2>
      <div class="filters">
        <div class="filter-group">
          <label>Domain:</label>
          <select class="filter-select" id="domainFilter"></select>
        </div>
        <div class="filter-group">
          <label>Priority:</label>
          <button class="filter-btn" data-filter="priority" data-value="HIGH">HIGH</button>
          <button class="filter-btn" data-filter="priority" data-value="MEDIUM">MEDIUM</button>
          <button class="filter-btn" data-filter="priority" data-value="LOW">LOW</button>
        </div>
        <div class="filter-group">
          <label>Status:</label>
          <button class="filter-btn" data-filter="status" data-value="DRAFT">DRAFT</button>
          <button class="filter-btn" data-filter="status" data-value="ACCEPTED">ACCEPTED</button>
          <button class="filter-btn" data-filter="status" data-value="CONFIRMED">CONFIRMED</button>
          <button class="filter-btn" data-filter="status" data-value="DEV">DEV</button>
          <button class="filter-btn" data-filter="status" data-value="DONE">DONE</button>
          <button class="filter-btn" data-filter="status" data-value="REJECTED">REJECTED</button>
        </div>
        <div class="filter-group" style="margin-left:auto;">
          <input type="text" class="search-box" id="searchBox" placeholder="Search REQ ID or title...">
        </div>
      </div>

      <div class="confirm-section">
        <button class="confirm-btn" id="confirmBtn" onclick="doConfirm()">Confirm All (ACCEPTED/DRAFT \\u2192 CONFIRMED)</button>
        <span class="confirm-result" id="confirmResult"></span>
      </div>

      <table class="req-table">
        <thead><tr><th></th><th>ID</th><th>Status</th><th>Priority</th><th>Title</th></tr></thead>
        <tbody id="reqTableBody"></tbody>
      </table>
      <div class="pagination" id="pagination"></div>
    </div>
  </div>

  <!-- ========== DELIVERABLES VIEW ========== -->
  <div class="view-section" id="view-deliverables">
    <div class="card" id="deliverablesCard">
      <h2>Deliverables</h2>
      <div id="deliverablesList"></div>
    </div>
  </div>

  <!-- ========== TASKS VIEW ========== -->
  <div class="view-section" id="view-tasks">
    <div class="card" id="tasksCard">
      <h2>Tasks <span class="badge" id="taskCount">0</span></h2>
      <div id="tasksList"></div>
    </div>

    <div class="card" id="auditCard">
      <h2>Audit Summary</h2>
      <div id="auditSummary"><span class="loading">Not loaded</span></div>
    </div>
  </div>

  <!-- Detail panel (side) -->
  <div class="panel-overlay" id="panelOverlay"></div>
  <div class="detail-panel" id="detailPanel">
    <div class="detail-panel-header">
      <h3 id="dpHeaderId">—</h3>
      <button class="detail-panel-close" id="dpClose">\\u2715</button>
    </div>
    <div class="detail-panel-body" id="dpBody"></div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
  (function() {
    // ============ State ============
    var allReqs = [];
    var allTasks = [];
    var filteredReqs = [];
    var currentPage = 1;
    var PAGE_SIZE = 50;
    var openDetails = {};
    var activePriorities = {};
    var activeStatuses = {};
    var domains = [];
    var currentView = 'board';
    var boardPriorityFilter = 'ALL';
    var selectedReqId = null;

    // Kanban column definitions
    var KANBAN_COLUMNS = ['DRAFT', 'DECOMPOSED', 'CONFIRMED', 'DEV', 'TESTING', 'DONE'];

    // ============ API ============
    function api(method, url, body) {
      var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      return fetch(url, opts).then(function(r) { return r.json(); });
    }

    // ============ Toast ============
    function showToast(msg) {
      var t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(function() { t.classList.remove('show'); }, 2500);
    }

    // ============ Escape HTML ============
    function escH(s) {
      if (!s) return '';
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    // ============ View Tabs ============
    var viewTabs = document.querySelectorAll('.view-tab');
    viewTabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var view = tab.getAttribute('data-view');
        switchView(view);
      });
    });

    function switchView(view) {
      currentView = view;
      viewTabs.forEach(function(tab) {
        tab.classList.toggle('active', tab.getAttribute('data-view') === view);
      });
      var sections = document.querySelectorAll('.view-section');
      sections.forEach(function(sec) {
        sec.classList.toggle('active', sec.id === 'view-' + view);
      });
    }

    // ============ Load Status ============
    function loadStatus() {
      api('GET', '/api/status').then(function(data) {
        var hdr = document.getElementById('headerMeta');
        hdr.innerHTML = '<span>' + escH(data.project_name) + '</span>' +
          '<span>conductor: ' + escH(data.conductor || 'none') + '</span>' +
          '<span>' + data.counts.total + ' REQs</span>';

        document.getElementById('projectLabel').textContent = data.project_name;

        var pct = data.counts.total > 0 ? Math.round((data.counts.done / data.counts.total) * 100) : 0;
        var fill = document.getElementById('progressFill');
        fill.style.width = pct + '%';
        fill.textContent = pct + '%';

        var counters = document.getElementById('counters');
        var items = [
          { cls: 'done', label: 'DONE', val: data.counts.done },
          { cls: 'dev', label: 'DEV', val: data.counts.dev },
          { cls: 'confirmed', label: 'CONFIRMED', val: data.counts.confirmed },
          { cls: 'draft', label: 'DRAFT', val: data.counts.draft },
          { cls: 'stale', label: 'STALE', val: data.counts.stale },
          { cls: 'deprecated', label: 'DEPRECATED', val: data.counts.deprecated },
        ];
        counters.innerHTML = items.map(function(it) {
          return '<div class="counter ' + it.cls + '"><div class="value">' + it.val + '</div><div class="label">' + it.label + '</div></div>';
        }).join('');

        // Stats bar
        updateStatsBar(data.counts);
      });
    }

    function updateStatsBar(counts) {
      var total = counts.total || 0;
      var done = counts.done || 0;
      var pct = total > 0 ? Math.round((done / total) * 100) : 0;

      var summary = document.getElementById('statsSummary');
      var parts = [
        { label: 'Total', value: total, cls: '' },
        { label: 'DRAFT', value: counts.draft || 0, cls: 'draft' },
        { label: 'CONFIRMED', value: counts.confirmed || 0, cls: 'confirmed' },
        { label: 'DEV', value: counts.dev || 0, cls: 'dev' },
        { label: 'DONE', value: done, cls: 'done' },
      ];
      summary.innerHTML = parts.map(function(p) {
        return '<div class="stat-item"><span class="stat-label">' + p.label + ':</span> <span class="stat-value ' + p.cls + '">' + p.value + '</span></div>';
      }).join('');

      var sfill = document.getElementById('statsProgressFill');
      sfill.style.width = Math.max(pct, 2) + '%';
      sfill.textContent = pct + '%';
    }

    // ============ Load Deliverables ============
    function loadDeliverables() {
      api('GET', '/api/deliverables').then(function(data) {
        var el = document.getElementById('deliverablesList');
        var iconMap = { done: '\\u2713', wip: '\\u25C9', warn: '\\u25B3', pending: '\\u25CB', stale: '!' };
        el.innerHTML = Object.keys(data).map(function(id) {
          var d = data[id];
          return '<div class="del-row"><span class="del-icon ' + d.icon + '">' + (iconMap[d.icon] || '\\u25CB') + '</span>' +
            '<span class="del-id">' + id + '</span>' +
            '<span class="del-name">' + escH(d.name) + '</span>' +
            '<span class="del-detail">' + escH(d.detail) + '</span></div>';
        }).join('');
      });
    }

    // ============ Build assignee map from tasks ============
    function buildAssigneeMap() {
      var map = {};
      for (var i = 0; i < allTasks.length; i++) {
        var t = allTasks[i];
        if (t.assignees && t.req_ids) {
          for (var j = 0; j < t.req_ids.length; j++) {
            map[t.req_ids[j]] = t.assignees.join(', ');
          }
        }
      }
      return map;
    }

    // ============ Build requester map from tasks ============
    function buildRequesterMap() {
      var map = {};
      for (var i = 0; i < allTasks.length; i++) {
        var t = allTasks[i];
        if (t.requester && t.req_ids) {
          for (var j = 0; j < t.req_ids.length; j++) {
            map[t.req_ids[j]] = t.requester;
          }
        }
      }
      return map;
    }

    // ============ Load Specs ============
    function loadSpecs() {
      api('GET', '/api/specs').then(function(data) {
        allReqs = data;
        // Build domain list
        var domSet = {};
        for (var i = 0; i < allReqs.length; i++) {
          if (allReqs[i].domain) domSet[allReqs[i].domain] = true;
        }
        domains = Object.keys(domSet).sort();

        // Update list view domain filter
        var sel = document.getElementById('domainFilter');
        var curVal = sel.value;
        sel.innerHTML = '<option value="">All</option>' +
          domains.map(function(d) { return '<option value="' + escH(d) + '">' + escH(d) + '</option>'; }).join('');
        sel.value = curVal;

        // Update board domain filter
        var bSel = document.getElementById('boardDomainFilter');
        var bCurVal = bSel.value;
        bSel.innerHTML = '<option value="">All</option>' +
          domains.map(function(d) { return '<option value="' + escH(d) + '">' + escH(d) + '</option>'; }).join('');
        bSel.value = bCurVal;

        // Update assignee filter
        updateAssigneeFilter();
        // Update requester filter
        updateRequesterFilter();

        applyFilters();
        renderKanban();
      });
    }

    function updateAssigneeFilter() {
      var assigneeMap = buildAssigneeMap();
      var assigneeSet = {};
      for (var k in assigneeMap) {
        if (assigneeMap[k]) assigneeSet[assigneeMap[k]] = true;
      }
      var assignees = Object.keys(assigneeSet).sort();
      var aSel = document.getElementById('boardAssigneeFilter');
      var aCurVal = aSel.value;
      aSel.innerHTML = '<option value="">All</option><option value="__unassigned__">Unassigned</option>' +
        assignees.map(function(a) { return '<option value="' + escH(a) + '">' + escH(a) + '</option>'; }).join('');
      aSel.value = aCurVal;
    }

    function updateRequesterFilter() {
      var requesterMap = buildRequesterMap();
      var reqSet = {};
      for (var k in requesterMap) {
        if (requesterMap[k]) reqSet[requesterMap[k]] = true;
      }
      var requesters = Object.keys(reqSet).sort();
      var rSel = document.getElementById('boardRequesterFilter');
      var rCurVal = rSel.value;
      rSel.innerHTML = '<option value="">All</option>' +
        requesters.map(function(r) { return '<option value="' + escH(r) + '">' + escH(r) + '</option>'; }).join('');
      rSel.value = rCurVal;
    }

    // ============ Load Tasks ============
    function loadTasks() {
      api('GET', '/api/tasks').then(function(data) {
        allTasks = data;
        document.getElementById('taskCount').textContent = data.length;
        var el = document.getElementById('tasksList');
        if (data.length === 0) {
          el.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">No tasks</div>';
          return;
        }
        el.innerHTML = data.map(function(t) {
          return '<div class="task-row">' +
            '<span class="task-id">' + escH(t.id) + '</span>' +
            '<span class="task-status status status-' + t.status.toLowerCase() + '">' + escH(t.status) + '</span>' +
            '<span class="task-title">' + escH(t.title) + '</span>' +
            '<span class="task-reqs">' + (t.req_ids ? t.req_ids.length : 0) + ' REQs</span></div>';
        }).join('');

        // Rebuild board filters after tasks loaded
        updateAssigneeFilter();
        updateRequesterFilter();
        renderKanban();
      });
    }

    // ============ Load Audit ============
    function loadAudit() {
      api('GET', '/api/audit').then(function(data) {
        var el = document.getElementById('auditSummary');
        if (data.error) {
          el.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem;">' + escH(data.error) + '</span>';
          return;
        }
        var r = data.results || {};
        el.innerHTML = '<div style="display:flex;gap:20px;font-size:0.9rem;">' +
          '<span style="color:var(--green);font-weight:600;">Pass: ' + (r.pass || 0) + '</span>' +
          '<span style="color:var(--yellow);font-weight:600;">Warn: ' + (r.warn || 0) + '</span>' +
          '<span style="color:var(--text-muted);font-weight:600;">Todo: ' + (r.todo || 0) + '</span>' +
          '<span style="color:var(--red);font-weight:600;">Stale: ' + (r.stale || 0) + '</span>' +
          (data.gate ? '<span style="font-weight:700;margin-left:12px;">Gate: ' + escH(data.gate) + '</span>' : '') +
          '</div>';
      });
    }

    // ============ Board Filters ============
    function applyBoardFilters(specs) {
      var domain = document.getElementById('boardDomainFilter').value;
      var assignee = document.getElementById('boardAssigneeFilter').value;
      var requester = document.getElementById('boardRequesterFilter').value;
      var search = document.getElementById('boardSearchBox').value.toLowerCase().trim();
      var assigneeMap = buildAssigneeMap();
      var requesterMap = buildRequesterMap();

      return specs.filter(function(s) {
        if (domain && s.domain !== domain) return false;
        if (boardPriorityFilter !== 'ALL' && s.priority !== boardPriorityFilter) return false;
        if (assignee === '__unassigned__') {
          if (assigneeMap[s.id]) return false;
        } else if (assignee && assigneeMap[s.id] !== assignee) {
          return false;
        }
        if (requester) {
          if (requesterMap[s.id] !== requester) return false;
        }
        if (search && s.id.toLowerCase().indexOf(search) === -1 && s.title.toLowerCase().indexOf(search) === -1) return false;
        return true;
      });
    }

    // ============ Kanban Rendering ============
    function renderKanban() {
      var filtered = applyBoardFilters(allReqs);
      var assigneeMap = buildAssigneeMap();

      // Group by status
      var groups = {};
      for (var ci = 0; ci < KANBAN_COLUMNS.length; ci++) {
        groups[KANBAN_COLUMNS[ci]] = [];
      }
      // Map non-standard statuses to columns
      var statusMap = {
        'DRAFT': 'DRAFT',
        'ACCEPTED': 'DRAFT',
        'DECOMPOSED': 'DECOMPOSED',
        'CONFIRMED': 'CONFIRMED',
        'DEV': 'DEV',
        'IN_PROGRESS': 'DEV',
        'TESTING': 'TESTING',
        'DONE': 'DONE',
        'CLOSED': 'DONE',
        'REJECTED': 'DRAFT',
        'DEPRECATED': 'DRAFT',
        'STALE': 'DRAFT',
      };

      for (var i = 0; i < filtered.length; i++) {
        var r = filtered[i];
        var col = statusMap[r.status] || 'DRAFT';
        if (groups[col]) groups[col].push(r);
      }

      var board = document.getElementById('kanbanBoard');
      var html = '';
      for (var ci = 0; ci < KANBAN_COLUMNS.length; ci++) {
        var colName = KANBAN_COLUMNS[ci];
        var items = groups[colName] || [];
        html += '<div class="kanban-column">';
        html += '<div class="kanban-column-header"><span>' + colName + '</span><span class="kanban-column-count">' + items.length + '</span></div>';
        html += '<div class="kanban-cards">';
        for (var j = 0; j < items.length; j++) {
          var req = items[j];
          var pClass = (req.priority || '').toLowerCase();
          var assigneeStr = assigneeMap[req.id] || '';
          html += '<div class="kanban-card ' + escH(pClass) + '" data-req-id="' + escH(req.id) + '">';
          html += '<div class="kanban-card-id">' + escH(req.id) + '</div>';
          html += '<div class="kanban-card-title">' + escH(req.title) + '</div>';
          html += '<div class="kanban-card-meta">';
          html += '<span class="kanban-card-priority ' + escH(pClass) + '">' + escH(req.priority) + '</span>';
          if (assigneeStr) html += '<span class="kanban-card-assignee">' + escH(assigneeStr) + '</span>';
          html += '</div>';
          html += '</div>';
        }
        html += '</div></div>';
      }
      board.innerHTML = html;

      // Attach click handlers
      var cards = board.querySelectorAll('.kanban-card');
      cards.forEach(function(card) {
        card.addEventListener('click', function() {
          var reqId = card.getAttribute('data-req-id');
          openDetailPanel(reqId);
        });
      });
    }

    // ============ Detail Panel ============
    function openDetailPanel(reqId) {
      selectedReqId = reqId;
      var req = null;
      for (var i = 0; i < allReqs.length; i++) {
        if (allReqs[i].id === reqId) { req = allReqs[i]; break; }
      }
      if (!req) return;

      var assigneeMap = buildAssigneeMap();
      var assigneeStr = assigneeMap[reqId] || 'Unassigned';

      document.getElementById('dpHeaderId').textContent = req.id;

      var body = '';
      body += '<div class="dp-title">' + escH(req.title) + '</div>';

      body += '<div style="display:flex;gap:8px;margin-bottom:12px;">';
      body += '<span class="dp-badge status-' + req.status.toLowerCase() + '">' + escH(req.status) + '</span>';
      body += '<span class="dp-badge priority-' + (req.priority || '').toLowerCase() + '">' + escH(req.priority) + '</span>';
      body += '</div>';

      body += '<div class="dp-field"><div class="dp-field-label">Description</div><div class="dp-field-value">' + escH(req.description || '(none)') + '</div></div>';
      body += '<div class="dp-field"><div class="dp-field-label">Assignee</div><div class="dp-field-value">' + escH(assigneeStr) + '</div></div>';
      body += '<div class="dp-field"><div class="dp-field-label">Created</div><div class="dp-field-value">' + escH(req.created || '(unknown)') + '</div></div>';

      if (req.code_refs && req.code_refs.length > 0) {
        body += '<div class="dp-field"><div class="dp-field-label">Code Refs</div><div class="dp-field-value">' +
          req.code_refs.map(function(c) { return '<code>' + escH(c) + '</code>'; }).join(' ') + '</div></div>';
      }
      if (req.test_refs && req.test_refs.length > 0) {
        body += '<div class="dp-field"><div class="dp-field-label">Test Refs</div><div class="dp-field-value">' +
          req.test_refs.map(function(c) { return '<code>' + escH(c) + '</code>'; }).join(' ') + '</div></div>';
      }
      if (req.assigned_model) {
        body += '<div class="dp-field"><div class="dp-field-label">Model</div><div class="dp-field-value">' + escH(req.assigned_model) + '</div></div>';
      }

      // Feedback history
      var feedbackList = req.feedback || [];
      body += '<div class="dp-section"><h4>Feedback History</h4>';
      if (feedbackList.length > 0) {
        for (var fi = 0; fi < feedbackList.length; fi++) {
          var fb = feedbackList[fi];
          body += '<div class="dp-fb-entry"><span class="fb-action ' + (fb.action || '') + '">' + escH(fb.action || '') + '</span>';
          body += ' by ' + escH(fb.from || 'unknown');
          if (fb.message) body += ' — ' + escH(fb.message);
          body += ' <span style="color:var(--text-dim);font-size:0.75rem;">' + escH((fb.at || '').slice(0, 19)) + '</span></div>';
        }
      } else {
        body += '<div style="color:var(--text-dim);font-size:0.85rem;">No feedback yet</div>';
      }
      body += '</div>';

      // Feedback form
      body += '<div class="dp-section"><h4>Actions</h4>';
      body += '<div class="dp-feedback-form">';
      body += '<input type="text" id="dpFrom" placeholder="From" value="reviewer">';
      body += '<input type="text" id="dpMsg" placeholder="Message (required for comment)">';
      body += '<div class="dp-feedback-btns">';
      body += '<button class="dp-fb-btn accept" onclick="dpFeedback(\\'accept\\')">Accept</button>';
      body += '<button class="dp-fb-btn reject" onclick="dpFeedback(\\'reject\\')">Reject</button>';
      body += '<button class="dp-fb-btn comment-btn" onclick="dpFeedback(\\'comment\\')">Comment</button>';
      body += '</div></div></div>';

      document.getElementById('dpBody').innerHTML = body;
      document.getElementById('detailPanel').classList.add('open');
      document.getElementById('panelOverlay').classList.add('open');
      document.body.classList.add('panel-open');
    }

    function closeDetailPanel() {
      document.getElementById('detailPanel').classList.remove('open');
      document.getElementById('panelOverlay').classList.remove('open');
      document.body.classList.remove('panel-open');
      selectedReqId = null;
    }

    document.getElementById('dpClose').addEventListener('click', closeDetailPanel);
    document.getElementById('panelOverlay').addEventListener('click', closeDetailPanel);

    // Panel feedback
    window.dpFeedback = function(action) {
      if (!selectedReqId) return;
      var msgEl = document.getElementById('dpMsg');
      var fromEl = document.getElementById('dpFrom');
      var message = msgEl ? msgEl.value : '';
      var from = fromEl ? fromEl.value : 'reviewer';

      if (action === 'comment' && !message.trim()) {
        showToast('Message is required for comment');
        return;
      }

      var body = { action: action, from: from || 'reviewer' };
      if (message.trim()) body.message = message.trim();

      api('POST', '/api/specs/' + encodeURIComponent(selectedReqId) + '/feedback', body)
        .then(function(res) {
          if (res.error) { showToast('Error: ' + res.error); return; }
          showToast(selectedReqId + ': ' + action + ' \\u2714');
          if (msgEl) msgEl.value = '';
          loadSpecs();
          // Re-open to refresh
          setTimeout(function() {
            if (selectedReqId) openDetailPanel(selectedReqId);
          }, 300);
        });
    };

    // ============ List View Filters ============
    function applyFilters() {
      var domain = document.getElementById('domainFilter').value;
      var search = document.getElementById('searchBox').value.toLowerCase().trim();
      var prioKeys = Object.keys(activePriorities);
      var statusKeys = Object.keys(activeStatuses);

      filteredReqs = allReqs.filter(function(r) {
        if (domain && r.domain !== domain) return false;
        if (prioKeys.length > 0 && !activePriorities[r.priority]) return false;
        if (statusKeys.length > 0 && !activeStatuses[r.status]) return false;
        if (search && r.id.toLowerCase().indexOf(search) === -1 && r.title.toLowerCase().indexOf(search) === -1) return false;
        return true;
      });

      currentPage = 1;
      renderReqs();
    }
    window.applyFilters = applyFilters;

    // ============ Toggle filter (list view) ============
    window.toggleFilter = function(btn) {
      var filter = btn.getAttribute('data-filter');
      var value = btn.getAttribute('data-value');
      var map = filter === 'priority' ? activePriorities : activeStatuses;

      if (map[value]) {
        delete map[value];
        btn.className = 'filter-btn';
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

    // ============ Render REQs (list view) ============
    function renderReqs() {
      var total = filteredReqs.length;
      var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;

      document.getElementById('reqCount').textContent = total + ' / ' + allReqs.length;

      var start = (currentPage - 1) * PAGE_SIZE;
      var pageReqs = filteredReqs.slice(start, start + PAGE_SIZE);

      var html = '';
      for (var i = 0; i < pageReqs.length; i++) {
        var r = pageReqs[i];
        var isOpen = openDetails[r.id];
        html += '<tr class="req-row" onclick="toggleDetail(\\'' + escH(r.id) + '\\')">';
        html += '<td><span class="chevron' + (isOpen ? ' open' : '') + '">\\u25B6</span></td>';
        html += '<td>' + escH(r.id) + '</td>';
        html += '<td class="status status-' + r.status.toLowerCase() + '">' + escH(r.status) + '</td>';
        html += '<td class="priority-' + (r.priority || '').toLowerCase() + '">' + escH(r.priority) + '</td>';
        html += '<td>' + escH(r.title) + '</td>';
        html += '</tr>';

        // Detail row
        html += '<tr class="req-detail' + (isOpen ? ' open' : '') + '" id="detail-' + escH(r.id) + '">';
        html += '<td colspan="5"><div class="detail-grid">';
        html += '<span class="detail-label">Description</span><span class="detail-value">' + escH(r.description || '(none)') + '</span>';
        html += '<span class="detail-label">Created</span><span class="detail-value">' + escH(r.created || '(unknown)') + '</span>';
        html += '<span class="detail-label">Code Refs</span><span class="detail-value">' + (r.code_refs && r.code_refs.length > 0 ? r.code_refs.map(function(c) { return '<code>' + escH(c) + '</code>'; }).join(' ') : '(none)') + '</span>';
        html += '<span class="detail-label">Test Refs</span><span class="detail-value">' + (r.test_refs && r.test_refs.length > 0 ? r.test_refs.map(function(c) { return '<code>' + escH(c) + '</code>'; }).join(' ') : '(none)') + '</span>';
        if (r.assigned_model) {
          html += '<span class="detail-label">Model</span><span class="detail-value">' + escH(r.assigned_model) + '</span>';
        }
        html += '</div>';

        // Feedback history
        var feedbackList = r.feedback || [];
        html += '<div class="feedback-section">';
        if (feedbackList.length > 0) {
          html += '<div class="feedback-history">';
          for (var fi = 0; fi < feedbackList.length; fi++) {
            var fb = feedbackList[fi];
            html += '<div class="fb-entry"><span class="fb-action ' + (fb.action || '') + '">' + escH(fb.action || '') + '</span>';
            html += ' by ' + escH(fb.from || 'unknown');
            if (fb.message) html += ' — ' + escH(fb.message);
            html += ' <span style="color:var(--text-dim);font-size:0.75rem;">' + escH((fb.at || '').slice(0, 19)) + '</span></div>';
          }
          html += '</div>';
        }

        // Feedback actions
        html += '<div class="feedback-actions">';
        html += '<input type="text" class="fb-from" id="from-' + escH(r.id) + '" placeholder="From" value="reviewer">';
        html += '<input type="text" class="fb-input" id="msg-' + escH(r.id) + '" placeholder="Message (required for comment)">';
        html += '<button class="fb-btn accept" onclick="event.stopPropagation(); doFeedback(\\'' + escH(r.id) + '\\', \\'accept\\')">Accept</button>';
        html += '<button class="fb-btn reject" onclick="event.stopPropagation(); doFeedback(\\'' + escH(r.id) + '\\', \\'reject\\')">Reject</button>';
        html += '<button class="fb-btn comment-btn" onclick="event.stopPropagation(); doFeedback(\\'' + escH(r.id) + '\\', \\'comment\\')">Comment</button>';
        html += '</div></div>';

        html += '</td></tr>';
      }
      document.getElementById('reqTableBody').innerHTML = html;

      // Pagination
      var pagHtml = '';
      if (totalPages > 1) {
        pagHtml += '<button class="page-btn" onclick="goToPage(1)"' + (currentPage === 1 ? ' disabled' : '') + '>\\u00AB</button>';
        pagHtml += '<button class="page-btn" onclick="goToPage(' + (currentPage - 1) + ')"' + (currentPage === 1 ? ' disabled' : '') + '>\\u2039</button>';
        var startP = Math.max(1, currentPage - 3);
        var endP = Math.min(totalPages, currentPage + 3);
        for (var p = startP; p <= endP; p++) {
          pagHtml += '<button class="page-btn' + (p === currentPage ? ' active' : '') + '" onclick="goToPage(' + p + ')">' + p + '</button>';
        }
        pagHtml += '<button class="page-btn" onclick="goToPage(' + (currentPage + 1) + ')"' + (currentPage === totalPages ? ' disabled' : '') + '>\\u203A</button>';
        pagHtml += '<button class="page-btn" onclick="goToPage(' + totalPages + ')"' + (currentPage === totalPages ? ' disabled' : '') + '>\\u00BB</button>';
        pagHtml += '<span class="page-info">' + (start + 1) + '-' + Math.min(start + PAGE_SIZE, total) + ' of ' + total + '</span>';
      }
      document.getElementById('pagination').innerHTML = pagHtml;
    }

    // ============ Toggle detail (list view) ============
    window.toggleDetail = function(id) {
      openDetails[id] = !openDetails[id];
      renderReqs();
    };

    // ============ Page navigation ============
    window.goToPage = function(p) {
      currentPage = p;
      renderReqs();
    };

    // ============ Feedback (list view) ============
    window.doFeedback = function(reqId, action) {
      var msgEl = document.getElementById('msg-' + reqId);
      var fromEl = document.getElementById('from-' + reqId);
      var message = msgEl ? msgEl.value : '';
      var from = fromEl ? fromEl.value : 'reviewer';

      if (action === 'comment' && !message.trim()) {
        showToast('Message is required for comment');
        return;
      }

      var body = { action: action, from: from || 'reviewer' };
      if (message.trim()) body.message = message.trim();

      api('POST', '/api/specs/' + encodeURIComponent(reqId) + '/feedback', body)
        .then(function(res) {
          if (res.error) { showToast('Error: ' + res.error); return; }
          showToast(reqId + ': ' + action + ' \\u2714');
          if (msgEl) msgEl.value = '';
          loadSpecs();
        });
    };

    // ============ Confirm ============
    window.doConfirm = function() {
      var btn = document.getElementById('confirmBtn');
      btn.disabled = true;
      api('POST', '/api/confirm', {})
        .then(function(res) {
          btn.disabled = false;
          if (res.error) { showToast('Error: ' + res.error); return; }
          var msg = 'Confirmed: ' + (res.confirmed || 0) + ', Deprecated: ' + (res.deprecated || 0);
          document.getElementById('confirmResult').textContent = msg;
          showToast(msg);
          refreshAll();
        });
    };

    // ============ Event listeners ============
    // List view
    document.getElementById('domainFilter').addEventListener('change', applyFilters);
    document.getElementById('searchBox').addEventListener('input', applyFilters);
    document.querySelectorAll('[data-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() { toggleFilter(btn); });
    });

    // Board view
    document.getElementById('boardDomainFilter').addEventListener('change', function() { renderKanban(); });
    document.getElementById('boardAssigneeFilter').addEventListener('change', function() { renderKanban(); });
    document.getElementById('boardRequesterFilter').addEventListener('change', function() { renderKanban(); });
    document.getElementById('boardSearchBox').addEventListener('input', function() { renderKanban(); });
    document.querySelectorAll('[data-board-filter]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var value = btn.getAttribute('data-value');
        boardPriorityFilter = value;
        // Update button styles
        document.querySelectorAll('[data-board-filter="priority"]').forEach(function(b) {
          b.className = 'filter-btn';
        });
        if (value === 'ALL') {
          btn.classList.add('active');
        } else {
          btn.classList.add('active-' + value.toLowerCase());
        }
        renderKanban();
      });
    });

    // Keyboard: Escape to close panel
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeDetailPanel();
    });

    // ============ Refresh ============
    function refreshAll() {
      loadStatus();
      loadDeliverables();
      loadTasks();
      loadSpecs();
      loadAudit();
    }

    // Initial load
    refreshAll();

    // Auto-refresh every 5 seconds
    setInterval(refreshAll, 5000);
  })();
  </script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
