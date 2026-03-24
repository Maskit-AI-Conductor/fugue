"""bpro snapshot — Reverse path: code -> REQ IDs."""

import fnmatch
from datetime import datetime, timezone
from pathlib import Path

import click

from bpro.core.project import (
    get_bpro_dir, load_config, save_spec, save_matrix,
)
from bpro.llm.ollama import get_client_from_config
from bpro.utils.display import (
    console, print_success, print_error, print_info, print_req_table, spinner_context,
)


SNAPSHOT_SYSTEM = """\
You are a reverse-engineering analyst. Given source code files, extract the functional requirements that the code implements.
Output ONLY a valid JSON array. No other text before or after.
Each requirement object has:
- "id": sequential like "REQ-001", "REQ-002"
- "title": short name (under 60 chars)
- "priority": one of "HIGH", "MEDIUM", "LOW" (based on how critical the functionality seems)
- "description": one sentence describing the testable behavior
- "source_files": list of filenames that implement this requirement

Focus on user-facing behaviors and business logic, not internal utilities or boilerplate.
If the code contains Korean comments or identifiers, keep title and description in Korean.
"""

MAX_FILE_SIZE = 50_000  # 50KB per file
MAX_BATCH_CHARS = 15_000  # ~4K tokens per batch


def scan_files(root: Path, config: dict) -> list[Path]:
    """Scan source files based on config include/exclude patterns."""
    scan_config = config.get("scan", {})
    includes = scan_config.get("include", ["**/*.py"])
    excludes = scan_config.get("exclude", [])

    files = []
    for pattern in includes:
        for f in root.glob(pattern):
            if not f.is_file():
                continue
            if f.stat().st_size > MAX_FILE_SIZE:
                continue
            rel = str(f.relative_to(root))
            if any(fnmatch.fnmatch(rel, ex) for ex in excludes):
                continue
            files.append(f)

    return sorted(set(files))


def batch_files(files: list[Path], root: Path) -> list[list[tuple[str, str]]]:
    """Group files into batches that fit within SLM context."""
    batches = []
    current_batch = []
    current_size = 0

    for f in files:
        content = f.read_text(encoding="utf-8", errors="replace")
        rel_path = str(f.relative_to(root))
        entry_size = len(content) + len(rel_path) + 50  # overhead

        if current_size + entry_size > MAX_BATCH_CHARS and current_batch:
            batches.append(current_batch)
            current_batch = []
            current_size = 0

        current_batch.append((rel_path, content))
        current_size += entry_size

    if current_batch:
        batches.append(current_batch)

    return batches


@click.command("snapshot")
def snapshot() -> None:
    """Reverse-engineer codebase into requirements."""
    bpro_dir = get_bpro_dir()
    if not bpro_dir:
        print_error("Not a bpro project. Run `bpro init` first.")
        raise SystemExit(1)

    config = load_config(bpro_dir)
    root = bpro_dir.parent

    # Scan files
    files = scan_files(root, config)
    if not files:
        print_error("No source files found. Check scan.include in .bpro/config.yaml")
        raise SystemExit(1)

    print_info(f"Found {len(files)} source files")

    # Check SLM
    client = get_client_from_config(config)
    if not client.check_health():
        print_error("Ollama is not running. Start it with: ollama serve")
        raise SystemExit(1)

    print_info(f"Reverse-engineering with {client.model}...")

    batches = batch_files(files, root)
    all_reqs = []
    req_counter = 1

    with spinner_context() as progress:
        task = progress.add_task(f"Scanning {len(batches)} batches...", total=len(batches))

        for batch in batches:
            file_block = "\n\n".join(
                f"--- {path} ---\n{content}" for path, content in batch
            )
            prompt = f"""\
Extract functional requirements from these source files:

{file_block}

Return a JSON array:
[{{"id": "REQ-{req_counter:03d}", "title": "...", "priority": "HIGH", "description": "...", "source_files": ["..."]}}]

Start numbering from REQ-{req_counter:03d}.
"""
            try:
                batch_reqs = client.generate_json(prompt, system=SNAPSHOT_SYSTEM)
                if isinstance(batch_reqs, list):
                    for req in batch_reqs:
                        req["id"] = f"REQ-{req_counter:03d}"
                        req_counter += 1
                        all_reqs.append(req)
            except Exception as e:
                print_info(f"Batch failed (skipping): {e}")

            progress.advance(task)

    if not all_reqs:
        print_error("No requirements extracted. Try with different source files.")
        raise SystemExit(1)

    # Save REQs
    now = datetime.now(timezone.utc).isoformat()
    for req in all_reqs:
        req["status"] = "DRAFT"
        req["created"] = now
        req.setdefault("code_refs", req.pop("source_files", []))
        req.setdefault("test_refs", [])
        save_spec(bpro_dir, req)

    # Create initial matrix
    matrix = {
        "version": 1,
        "created": now,
        "entries": {
            req["id"]: {
                "code_refs": req.get("code_refs", []),
                "test_refs": [],
            }
            for req in all_reqs
        },
    }
    save_matrix(bpro_dir, matrix)

    console.print()
    print_success(f"{len(all_reqs)} requirements reverse-engineered")
    print_req_table(all_reqs)
    console.print()
    console.print("  [dim]Review the REQs, then:[/] [cyan]bpro plan confirm[/]")
