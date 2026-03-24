"""bpro status — Project overview."""

import click

from bpro.core.project import get_bpro_dir, load_config, load_specs, load_matrix
from bpro.utils.display import (
    console, print_error, print_info, print_req_table,
    print_progress_bar, print_deliverable_tree,
)


@click.command("status")
@click.option("--deliverables", is_flag=True, help="Show deliverable tree (D.01-D.08)")
def status_cmd(deliverables: bool) -> None:
    """Show project status."""
    bpro_dir = get_bpro_dir()
    if not bpro_dir:
        print_error("Not a bpro project. Run `bpro init` first.")
        raise SystemExit(1)

    config = load_config(bpro_dir)
    reqs = load_specs(bpro_dir)
    matrix = load_matrix(bpro_dir)

    console.print()
    console.print(f"  [bold]{config.get('project_name', 'unnamed')}[/]")
    console.print()

    if not reqs:
        print_info("No requirements yet.")
        console.print("  [cyan]bpro plan import <file>[/]  — start from planning doc")
        console.print("  [cyan]bpro snapshot[/]            — reverse-engineer code")
        return

    # Count by status
    counts = {}
    for r in reqs:
        s = r.get("status", "UNKNOWN")
        counts[s] = counts.get(s, 0) + 1

    done = counts.get("DONE", 0)
    total = len(reqs)
    print_progress_bar(done, total, "REQs done")
    console.print()

    # Status summary
    status_line = []
    for s in ["DONE", "DEV", "CONFIRMED", "DRAFT", "STALE", "DEPRECATED"]:
        if counts.get(s, 0) > 0:
            status_line.append(f"{s}: {counts[s]}")
    console.print(f"  {' | '.join(status_line)}")
    console.print()

    # Matrix coverage
    if matrix and matrix.get("entries"):
        entries = matrix["entries"]
        code_mapped = sum(1 for e in entries.values() if e.get("code_refs"))
        test_mapped = sum(1 for e in entries.values() if e.get("test_refs"))
        console.print(f"  Code mapped: {code_mapped}/{total} | Tests mapped: {test_mapped}/{total}")
        console.print()

    if deliverables:
        _show_deliverables(bpro_dir, config, reqs, matrix)
    else:
        # Show top REQs
        print_req_table(reqs[:15], title=f"Requirements ({len(reqs)} total)")
        if len(reqs) > 15:
            console.print(f"  [dim]... and {len(reqs) - 15} more. Use `bpro status --deliverables` for full view.[/]")


def _show_deliverables(bpro_dir, config, reqs, matrix):
    """Build and show deliverable tree."""
    total = len(reqs)
    confirmed = sum(1 for r in reqs if r.get("status") in ("CONFIRMED", "DEV", "DONE"))
    done = sum(1 for r in reqs if r.get("status") == "DONE")

    entries = matrix.get("entries", {}) if matrix else {}
    code_mapped = sum(1 for e in entries.values() if e.get("code_refs"))
    test_mapped = sum(1 for e in entries.values() if e.get("test_refs"))

    has_plan = bool(config.get("plan", {}).get("source"))
    has_specs = total > 0
    has_confirmed = confirmed > 0

    # Audit reports
    audit_dir = bpro_dir / "reports"
    has_audit = any(audit_dir.glob("audit-*.yaml")) if audit_dir.exists() else False

    deliverables = {
        "D.01": {
            "name": "Planning Doc",
            "icon": "done" if has_plan else "pending",
            "detail": "imported" if has_plan else "not imported",
        },
        "D.02": {
            "name": "Requirements",
            "icon": "done" if has_confirmed else ("wip" if has_specs else "pending"),
            "detail": f"{confirmed} confirmed" if has_confirmed else (f"{total} draft" if has_specs else "none"),
        },
        "D.03": {
            "name": "Traceability Matrix",
            "icon": "wip" if code_mapped > 0 else "pending",
            "detail": f"{code_mapped}/{total} mapped" if total > 0 else "empty",
        },
        "D.04": {
            "name": "Design Doc",
            "icon": "pending",
            "detail": "optional",
        },
        "D.05": {
            "name": "Implementation",
            "icon": "wip" if done > 0 else "pending",
            "detail": f"{done}/{total} done" if total > 0 else "--",
        },
        "D.06": {
            "name": "Tests",
            "icon": "warn" if (test_mapped > 0 and test_mapped < total) else ("done" if test_mapped == total and total > 0 else "pending"),
            "detail": f"{test_mapped}/{total} pass" if total > 0 else "--",
        },
        "D.07": {
            "name": "Audit Report",
            "icon": "done" if has_audit else "pending",
            "detail": "gate run" if has_audit else "gate not run",
        },
        "D.08": {
            "name": "Progress Report",
            "icon": "pending",
            "detail": "not generated",
        },
    }

    print_deliverable_tree(deliverables)
