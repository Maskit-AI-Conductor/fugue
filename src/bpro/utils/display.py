"""Rich-based display utilities."""

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.text import Text

console = Console()


def print_success(msg: str) -> None:
    console.print(f"[green bold]OK[/] {msg}")


def print_warning(msg: str) -> None:
    console.print(f"[yellow bold]WARN[/] {msg}")


def print_error(msg: str) -> None:
    console.print(f"[red bold]ERR[/] {msg}")


def print_info(msg: str) -> None:
    console.print(f"[blue]>[/] {msg}")


def print_req_table(reqs: list[dict], title: str = "Requirements") -> None:
    table = Table(title=title, show_lines=False)
    table.add_column("ID", style="cyan", width=10)
    table.add_column("Status", width=8)
    table.add_column("Priority", width=8)
    table.add_column("Title")

    status_styles = {
        "DRAFT": "[dim]DRAFT[/]",
        "CONFIRMED": "[blue]CONF[/]",
        "DEV": "[yellow]DEV[/]",
        "DONE": "[green]DONE[/]",
        "DEPRECATED": "[dim strikethrough]DEPR[/]",
        "STALE": "[red]STALE[/]",
    }
    priority_styles = {
        "HIGH": "[red]HIGH[/]",
        "MEDIUM": "[yellow]MED[/]",
        "LOW": "[dim]LOW[/]",
    }

    for req in reqs:
        status = status_styles.get(req.get("status", ""), req.get("status", ""))
        priority = priority_styles.get(req.get("priority", ""), req.get("priority", ""))
        table.add_row(req["id"], status, priority, req.get("title", ""))

    console.print(table)


def print_progress_bar(done: int, total: int, label: str = "Progress") -> None:
    if total == 0:
        console.print(f"  {label}: no items")
        return
    pct = done / total
    filled = int(pct * 15)
    bar = "[green]" + "█" * filled + "[/]" + "░" * (15 - filled)
    console.print(f"  {bar}  {done}/{total} {label} ({pct:.0%})")


def print_deliverable_tree(deliverables: dict) -> None:
    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("ID", style="cyan", width=6)
    table.add_column("Name", width=25)
    table.add_column("Status", width=30)

    status_icons = {
        "done": "[green]✓[/]",
        "wip": "[yellow]◉[/]",
        "warn": "[yellow]△[/]",
        "pending": "[dim]○[/]",
        "stale": "[red]![/]",
    }

    for d_id, info in deliverables.items():
        icon = status_icons.get(info.get("icon", "pending"), "[dim]○[/]")
        table.add_row(d_id, info.get("name", ""), f"{icon} {info.get('detail', '')}")

    console.print(Panel(table, title="Deliverables", border_style="blue"))


def spinner_context(text: str = "Processing..."):
    return Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
        transient=True,
    )
