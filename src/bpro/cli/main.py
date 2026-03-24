"""bpro CLI entry point."""

import click

from bpro import __version__


@click.group()
@click.version_option(version=__version__, prog_name="bpro")
def cli():
    """bpro — Beyond Prototype. AI-powered PMO for your terminal."""
    pass


# Register commands
from bpro.cli.init import init_cmd
from bpro.cli.plan import plan
from bpro.cli.snapshot import snapshot
from bpro.cli.audit import audit
from bpro.cli.status import status_cmd

cli.add_command(init_cmd, "init")
cli.add_command(plan, "plan")
cli.add_command(snapshot, "snapshot")
cli.add_command(audit, "audit")
cli.add_command(status_cmd, "status")


if __name__ == "__main__":
    cli()
