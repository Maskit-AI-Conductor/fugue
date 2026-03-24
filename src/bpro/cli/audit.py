"""bpro audit — Run audit (gap detection, gate judgment)."""

from datetime import datetime, timezone
from pathlib import Path

import click
import yaml

from bpro.core.project import get_bpro_dir, load_config, load_specs, load_matrix
from bpro.utils.display import console, print_success, print_warning, print_error, print_info


@click.command("audit")
@click.option("--quick", is_flag=True, default=True, help="Quick audit (file-based, no SLM)")
@click.option("--gate", is_flag=True, help="Run gate judgment (PASS/CONDITIONAL/FAIL)")
def audit(quick: bool, gate: bool) -> None:
    """Run audit: check REQ coverage, test gaps, code changes."""
    bpro_dir = get_bpro_dir()
    if not bpro_dir:
        print_error("Not a bpro project. Run `bpro init` first.")
        raise SystemExit(1)

    reqs = load_specs(bpro_dir)
    if not reqs:
        print_warning("No requirements to audit. Run `bpro plan import` or `bpro snapshot` first.")
        return

    matrix = load_matrix(bpro_dir)
    entries = matrix.get("entries", {}) if matrix else {}
    root = bpro_dir.parent

    results = {"pass": [], "warn": [], "new": [], "stale": [], "fail": []}

    for req in reqs:
        req_id = req["id"]
        status = req.get("status", "")

        if status == "DEPRECATED":
            continue

        entry = entries.get(req_id, {})
        code_refs = entry.get("code_refs", []) or req.get("code_refs", [])
        test_refs = entry.get("test_refs", [])

        # Check code mapping
        has_code = bool(code_refs)
        code_exists = False
        code_changed = False
        if has_code:
            for ref in code_refs:
                ref_path = root / ref
                if ref_path.exists():
                    code_exists = True

        # Check test mapping
        has_test = bool(test_refs)

        # Categorize
        if not has_code:
            if status in ("CONFIRMED", "DRAFT"):
                results["new"].append((req_id, req.get("title", ""), "not implemented"))
            else:
                results["warn"].append((req_id, req.get("title", ""), "no code mapped"))
        elif has_code and not code_exists:
            results["stale"].append((req_id, req.get("title", ""), "code file missing"))
        elif has_code and not has_test:
            results["warn"].append((req_id, req.get("title", ""), "no tests"))
        else:
            results["pass"].append((req_id, req.get("title", ""), "ok"))

    # Display
    console.print()
    total = sum(len(v) for v in results.values())

    for req_id, title, detail in results["pass"]:
        console.print(f"  [green]PASS[/]  {req_id}: {title}")
    for req_id, title, detail in results["warn"]:
        console.print(f"  [yellow]WARN[/]  {req_id}: {title} — {detail}")
    for req_id, title, detail in results["new"]:
        console.print(f"  [blue]TODO[/]  {req_id}: {title} — {detail}")
    for req_id, title, detail in results["stale"]:
        console.print(f"  [red]STALE[/] {req_id}: {title} — {detail}")

    console.print()
    summary = (
        f"  PASS {len(results['pass'])} | "
        f"WARN {len(results['warn'])} | "
        f"TODO {len(results['new'])} | "
        f"STALE {len(results['stale'])}"
    )
    console.print(summary)

    # Gate judgment
    if gate:
        console.print()
        if results["stale"] or results["fail"]:
            console.print("  [red bold]Gate: FAIL[/] — stale or failing items")
        elif results["warn"] or results["new"]:
            console.print("  [yellow bold]Gate: CONDITIONAL PASS[/] — warnings/todos remain")
        else:
            console.print("  [green bold]Gate: PASS[/]")

    # Save audit result
    audit_result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": {k: len(v) for k, v in results.items()},
        "details": {
            k: [{"id": r[0], "title": r[1], "detail": r[2]} for r in v]
            for k, v in results.items()
        },
    }
    reports_dir = bpro_dir / "reports"
    reports_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    with open(reports_dir / f"audit-{ts}.yaml", "w") as f:
        yaml.dump(audit_result, f, default_flow_style=False, allow_unicode=True)

    console.print()
    console.print(f"  [dim]Saved to .bpro/reports/audit-{ts}.yaml[/]")
