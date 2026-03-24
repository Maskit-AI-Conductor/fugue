"""bpro plan — Forward path: planning doc -> REQ IDs -> development."""

import shutil
from datetime import datetime, timezone
from pathlib import Path

import click
import yaml

from bpro.core.project import (
    get_bpro_dir, load_config, save_config, load_specs, save_spec, save_matrix,
)
from bpro.llm.ollama import get_client_from_config
from bpro.utils.display import (
    console, print_success, print_warning, print_error, print_info,
    print_req_table, spinner_context,
)


DECOMPOSE_SYSTEM = """\
You are a requirements analyst. Extract functional requirements from a planning document.
Output ONLY a valid JSON array. No other text before or after.
Each requirement object has these fields:
- "id": sequential like "REQ-001", "REQ-002"
- "title": short name (under 60 chars)
- "priority": one of "HIGH", "MEDIUM", "LOW"
- "description": one sentence describing the testable behavior
- "source_section": which section of the document this came from

Keep each requirement atomic — one testable behavior per REQ.
If the document is in Korean, keep title and description in Korean.
"""


@click.group("plan")
def plan() -> None:
    """Forward path: planning doc -> REQ IDs -> development."""
    pass


@plan.command("import")
@click.argument("file", type=click.Path(exists=True))
def import_cmd(file: str) -> None:
    """Import a planning document (Markdown)."""
    bpro_dir = get_bpro_dir()
    if not bpro_dir:
        print_error("Not a bpro project. Run `bpro init` first.")
        raise SystemExit(1)

    src = Path(file)
    if src.suffix.lower() not in (".md", ".txt", ".markdown"):
        print_warning(f"Expected Markdown file, got {src.suffix}. Importing anyway.")

    # Copy to .bpro/plans/
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = bpro_dir / "plans" / f"{src.stem}_{timestamp}{src.suffix}"
    shutil.copy2(src, dest)

    # Update config
    config = load_config(bpro_dir)
    config.setdefault("plan", {})["source"] = str(dest.relative_to(bpro_dir))
    config["plan"]["imported_at"] = datetime.now(timezone.utc).isoformat()
    config["plan"]["original_path"] = str(src.resolve())
    save_config(bpro_dir, config)

    line_count = len(dest.read_text(encoding="utf-8").splitlines())
    print_success(f"Imported {src.name} ({line_count} lines)")
    console.print(f"  [dim]Saved to .bpro/plans/{dest.name}[/]")
    console.print()
    console.print("  [dim]Next:[/] [cyan]bpro plan decompose[/] — extract REQ IDs")


@plan.command("decompose")
def decompose_cmd() -> None:
    """Decompose planning doc into REQ IDs using SLM."""
    bpro_dir = get_bpro_dir()
    if not bpro_dir:
        print_error("Not a bpro project. Run `bpro init` first.")
        raise SystemExit(1)

    config = load_config(bpro_dir)
    plan_source = config.get("plan", {}).get("source")
    if not plan_source:
        print_error("No planning doc imported. Run `bpro plan import <file>` first.")
        raise SystemExit(1)

    doc_path = bpro_dir / plan_source
    if not doc_path.exists():
        print_error(f"Planning doc not found: {doc_path}")
        raise SystemExit(1)

    doc_content = doc_path.read_text(encoding="utf-8")

    # Check SLM
    client = get_client_from_config(config)
    if not client.check_health():
        print_error("Ollama is not running. Start it with: ollama serve")
        print_info(f"Expected at: {client.endpoint}")
        raise SystemExit(1)

    print_info(f"Decomposing with {client.model}...")

    prompt = f"""\
Extract requirements from this planning document:

---
{doc_content}
---

Return a JSON array:
[{{"id": "REQ-001", "title": "...", "priority": "HIGH", "description": "...", "source_section": "..."}}]
"""

    with spinner_context() as progress:
        progress.add_task("Extracting requirements...", total=None)
        try:
            reqs_data = client.generate_json(prompt, system=DECOMPOSE_SYSTEM)
        except Exception as e:
            print_error(f"SLM failed: {e}")
            raise SystemExit(1)

    if not isinstance(reqs_data, list):
        print_error("SLM returned unexpected format. Expected JSON array.")
        raise SystemExit(1)

    # Save REQs
    now = datetime.now(timezone.utc).isoformat()
    saved = []
    for req in reqs_data:
        if not req.get("id"):
            continue
        req["status"] = "DRAFT"
        req["created"] = now
        req.setdefault("code_refs", [])
        req.setdefault("test_refs", [])
        req.setdefault("source", {
            "file": str(plan_source),
            "section": req.pop("source_section", ""),
        })
        save_spec(bpro_dir, req)
        saved.append(req)

    console.print()
    print_success(f"{len(saved)} requirements extracted")
    print_req_table(saved)
    console.print()
    console.print("  [dim]Review the REQs above, then:[/] [cyan]bpro plan confirm[/]")


@plan.command("confirm")
def confirm_cmd() -> None:
    """Confirm all DRAFT REQs and start development phase."""
    bpro_dir = get_bpro_dir()
    if not bpro_dir:
        print_error("Not a bpro project. Run `bpro init` first.")
        raise SystemExit(1)

    reqs = load_specs(bpro_dir)
    draft_reqs = [r for r in reqs if r.get("status") == "DRAFT"]

    if not draft_reqs:
        print_warning("No DRAFT requirements to confirm.")
        if reqs:
            confirmed = [r for r in reqs if r.get("status") == "CONFIRMED"]
            print_info(f"{len(confirmed)} REQs already confirmed.")
        return

    print_req_table(draft_reqs, title=f"Confirming {len(draft_reqs)} REQs")
    console.print()

    if not click.confirm(f"Confirm all {len(draft_reqs)} requirements?", default=True):
        print_info("Cancelled.")
        return

    # Update status
    for req in draft_reqs:
        req["status"] = "CONFIRMED"
        req["confirmed_at"] = datetime.now(timezone.utc).isoformat()
        save_spec(bpro_dir, req)

    # Initialize empty traceability matrix
    matrix = {
        "version": 1,
        "created": datetime.now(timezone.utc).isoformat(),
        "entries": {req["id"]: {"code_refs": [], "test_refs": []} for req in draft_reqs},
    }
    save_matrix(bpro_dir, matrix)

    print_success(f"{len(draft_reqs)} REQs confirmed. Development phase started.")
    console.print()
    console.print("  [dim]Next:[/]")
    console.print("  [cyan]bpro status[/]            — check progress")
    console.print("  [cyan]bpro audit --quick[/]     — run first audit")
