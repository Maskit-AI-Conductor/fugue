"""bpro init — Initialize project."""

import click
from pathlib import Path

from bpro.core.project import init_project, find_project_root
from bpro.utils.display import console, print_success, print_warning, print_error


@click.command("init")
@click.option("--force", is_flag=True, help="Reinitialize existing .bpro/")
def init_cmd(force: bool) -> None:
    """Initialize bpro in the current directory."""
    root = Path.cwd()

    if find_project_root(root) and not force:
        print_warning(".bpro/ already exists. Use --force to reinitialize.")
        return

    try:
        bpro_path = init_project(root, force=force)
    except Exception as e:
        print_error(str(e))
        raise SystemExit(1)

    print_success(f"Initialized .bpro/ in {root.name}/")
    console.print()
    console.print("  [dim]Next steps:[/]")
    console.print("  [cyan]bpro plan import ./planning-doc.md[/]  — start from a planning doc (Forward)")
    console.print("  [cyan]bpro snapshot[/]                       — reverse-engineer existing code (Reverse)")
    console.print()
