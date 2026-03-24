# bpro

**Beyond Prototype.** Your AI-powered PMO that turns side projects into production-grade software.

> bpro reverse-engineers your codebase into requirements, tests, and E2E traceability — or decomposes your planning doc into trackable REQ IDs. Then it governs your AI agents with audit trails. All from your terminal.

```bash
pip install bpro-cli   # coming soon
```

---

## What is bpro?

bpro sits **between your code editor and your project board**. It doesn't write code — it makes sure the code you (or your AI agents) wrote is production-ready.

```
Your AI tools:
+-------------+  +----------+  +----------+  +----------+
| Claude Code |  |  Cursor  |  |  Codex   |  |  Ollama  |
+------+------+  +-----+----+  +-----+----+  +-----+----+
       |               |             |              |
       +-------+-------+------+------+------+-------+
               |
         +-----v-----+
         |   bpro    |  <-- sits underneath, like git
         | (PMO/audit)|      works with any AI tool
         +-----------+
```

**bpro is not an AI.** It's the manager of your AIs.

---

## Daily Usage (How our team actually uses it)

We're a 6-person startup running 15+ AI agent roles. Here's how we use bpro every day.

### Morning Check: "Where are we?"

```bash
$ bpro status
  ■■■■■■■░░░░░░░  12/38 REQs done (32%)

  REQ-001 [DONE]  사용자 로그인           tests: 8/8 PASS
  REQ-002 [DONE]  비밀번호 재설정          tests: 7/7 PASS
  REQ-012 [DEV]   결제 프로세스           tests: 3/5 FAIL
  REQ-013 [TODO]  환불 정책              tests: --
  ...

  Agents: auditor 3 runs, tester 5 runs this week
  Cost: $0.00 (SLM 100%)

$ bpro status --deliverables
  D.01 Planning Doc        DONE   imported
  D.02 Requirements        DONE   38 REQs confirmed
  D.03 Traceability Matrix  WIP    12/38 mapped
  D.05 Implementation       WIP    12/38 done
  D.06 Tests               WARN   8/38 pass, 4 fail
  D.07 Audit Report         --    gate not run yet
  ─────────────────────────────────
  Gate: run after D.06 complete
```

### After Coding: "Did I break anything?"

```bash
$ bpro audit
  REQ-012: code changed, test not updated [WARN]
  REQ-025: new code detected, no REQ mapped [NEW]
  REQ-005: planning doc changed, code STALE [STALE]
  ─────────────────────────────────
  Gate: CONDITIONAL PASS (3 issues)
```

### Weekly Review: "Report for the team"

```bash
$ bpro report
  -> .bpro/reports/2026-03-24-progress.html generated
  -> Open in browser? [Y/n]
```

The HTML report shows progress, test results, and change history. Share it with your planner — they don't need to install bpro.

---

## Two Ways to Start

### Path 1: Reverse — You already have code

Your side project has been running for weeks. No docs, no tests, no requirements. Classic.

```bash
$ cd my-side-project
$ bpro init
# .bpro/ created. Watching for changes. That's it.

$ bpro snapshot
# Scanning codebase with SLM...
# -> 23 requirements extracted (code -> REQ reverse-trace)
# -> 15 test outlines generated (coverage gaps marked)
# -> E2E traceability matrix created (REQ <-> code <-> test)
# -> Saved to .bpro/specs/, .bpro/tests/, .bpro/matrix/

$ bpro audit --quick
#  PASS  15 | WARN  5 | NEW  3
```

### Path 2: Forward — You have a planning doc first

Your planner wrote a spec in Notion or Markdown. Now you want to track it properly.

```bash
$ bpro init
$ bpro plan import ./planning-doc.md

$ bpro plan decompose
# -> REQ-001: User login [HIGH]
# -> REQ-002: Password reset [MEDIUM]
# -> REQ-003: Profile edit [LOW]
# -> ... 38 REQs extracted. Waiting for planner confirmation.

# Planner reviews and confirms
$ bpro plan confirm
# -> 38 REQs locked. Development phase started.
# -> Empty traceability matrix created.

# Developer works, bpro tracks
$ bpro audit
# -> REQ-001: code mapped, no test yet [WARN]
# -> REQ-015: not implemented [TODO]
```

Both paths converge into the **same deliverable tree** (see below).

---

## Change Management

Requirements change. That's life. bpro tracks every change and shows the impact.

```bash
# Planner updated the spec? Diff it.
$ bpro plan diff ./planning-doc-v2.md
  + REQ-039: Social login (new)
  ~ REQ-005: Password policy (changed)
  - REQ-012: Email verification (removed)
  -> Apply changes? [Y/n]

$ bpro plan apply
# -> D.02 updated (38 -> 39 REQs)
# -> D.03 matrix: 3 rows marked STALE
# -> Change log: CHG-001~003 recorded

# Check impact of a specific change
$ bpro plan impact REQ-005
#  Code:  src/auth/password.ts (L42-68) — needs update
#  Tests: tests/auth/password.test.ts — needs rewrite
#  Related: REQ-001 (login) — indirect impact

# View full change history
$ bpro changelog
  CHG-001 [03-24] REQ-039 added — "Social login"
  CHG-002 [03-25] REQ-005 modified — password policy change
  CHG-003 [03-25] REQ-012 deprecated — scope reduction
```

---

## Agent Governance

If you use AI agents (Claude Code, Cursor agents, custom agents), bpro tracks what they do.

**The most important lesson we learned: defining what an agent must NOT do is more important than defining what it should do.**

```bash
# Define an agent with scope, manual, and boundaries
$ bpro agent define auditor \
    --scope "Code quality audit" \
    --manual ./manuals/auditor.md \
    --boundaries "Read only. No code modifications." \
    --never "Direct DB access, PASS without tests"

# Check agent work logs
$ bpro agent log auditor
  [03-24] Audit complete: 35/38 PASS, 3 WARN
  [03-24] Performance: coverage 83% -> 91% recommendation
  [03-24] Unresolved: REQ-012 no tests

# Evaluate agent performance
$ bpro agent eval
  auditor: log rate 100%, human feedback 4.2/5
  tester:  log rate 85%,  human feedback 3.8/5
```

---

## Deliverable Tree

Every project managed by bpro follows this structure. **No skipping ahead — earlier deliverables must be completed before later ones.**

```
D.01 Planning Doc (plan import) or Reverse-engineered snapshot
  |
D.02 Requirements (REQ IDs - decompose or snapshot result)
  |  <- plan confirm or snapshot complete
D.03 Traceability Matrix (REQ <-> code <-> test, auto-generated)
  |
  +-> D.04 Design Doc (optional, auto-generated by snapshot)
  |
  +-> D.05 Implementation (developer work, REQ mapping auto-tracked)
  |
  +-> D.06 Tests + Results (test generate -> test run)
  |
  +-> D.07 Audit Report (audit --gate -> PASS/CONDITIONAL/FAIL)
  |
  +-> D.08 Progress Report (report -> HTML for planners/team)
```

---

## CLI Reference

```
bpro
+-- init                        # Start watching project
+-- snapshot                    # [Reverse] Code -> REQ/tests/matrix
+-- plan                        # [Forward] Planning doc workflow
|   +-- import <file>           # Import planning doc
|   +-- decompose               # Extract REQ IDs (SLM)
|   +-- confirm                 # Lock REQs, start dev phase
|   +-- add <req-id> <desc>     # Add REQ (change mgmt)
|   +-- modify <req-id>         # Modify REQ (impact analysis)
|   +-- deprecate <req-id>      # Deprecate REQ
|   +-- diff <file>             # Compare with updated doc
|   +-- apply                   # Apply changes
|   +-- impact <req-id>         # Impact analysis
+-- audit [--quick|--gate]      # Run audit (gap detection, gate)
+-- test
|   +-- generate                # Auto-generate tests per REQ
|   +-- run                     # Run all tests
+-- report                      # Generate HTML progress report
+-- changelog                   # View change history
+-- agent
|   +-- define <name>           # Define agent scope/manual/boundaries
|   +-- log <name>              # View agent work log
|   +-- eval                    # Evaluate agent performance
|   +-- list                    # List defined agents
+-- status [--deliverables]     # Project overview
+-- model
|   +-- config                  # Model routing (SLM/LLM)
+-- config                      # Global settings
```

---

## .bpro/ Directory Structure

```
.bpro/
  config.yaml       # Project settings (model, scan scope)
  specs/             # D.02 Requirements (REQ-001.md, ...)
  matrix/            # D.03 Traceability matrix
  tests/             # D.06 Test docs + results
  agents/            # Agent definitions (auditor.md, ...)
  logs/              # Agent work-logs, daily-logs
  reports/           # D.08 HTML reports
  models/            # Model routing config
  changes/           # Change history (CHG-001.md, ...)
  .gitignore         # Auto-generated, protects credentials
```

---

## Design Principles

1. **Never interrupt Phase 1.** Developers prototype freely. bpro only kicks in when they ask.
2. **Model-agnostic.** Works with Claude, GPT, Gemini, Ollama, or no AI at all.
3. **SLM-first.** Default model is local SLM (Ollama). LLM is fallback for complex reasoning.
4. **File-based.** No database dependency. Everything in `.bpro/`, trackable with git.
5. **Define what NOT to do.** Agent `--never` flags are more important than `--scope`.
6. **No deliverable skipping.** Gate rules enforce production quality step by step.

---

## Built by

[Maskit](https://maskit.co.kr) — a 6-person B2B SaaS startup that runs 15+ AI agent roles in production. bpro is extracted from our internal PMO system that tracks 2,375 requirements across 11 domains with 3-layer audit governance.

---

## License

Apache 2.0
