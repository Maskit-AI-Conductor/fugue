"""Project management — .bpro/ directory operations."""

import os
from pathlib import Path
from datetime import datetime, timezone

import yaml


BPRO_DIR = ".bpro"
CONFIG_FILE = "config.yaml"

SUBDIRS = [
    "specs",
    "matrix",
    "tests",
    "agents",
    "logs",
    "reports",
    "models",
    "changes",
    "plans",
]

DEFAULT_CONFIG = {
    "version": 1,
    "project_name": "",
    "model": {
        "provider": "ollama",
        "endpoint": "http://localhost:11434",
        "model": "qwen2.5:7b",
        "timeout": 120,
    },
    "scan": {
        "include": [
            "**/*.py", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx",
            "**/*.go", "**/*.rs", "**/*.java", "**/*.kt",
        ],
        "exclude": [
            "**/node_modules/**", "**/.venv/**", "**/venv/**",
            "**/dist/**", "**/build/**", "**/__pycache__/**",
            "**/.bpro/**", "**/.git/**",
        ],
    },
    "created": "",
}

GITIGNORE_CONTENT = """\
# bpro credentials
models/*.key
models/*.token
.credentials/
"""


def find_project_root(start: Path | None = None) -> Path | None:
    """Walk up from start to find .bpro/ directory."""
    current = start or Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / BPRO_DIR).is_dir():
            return parent
    return None


def get_bpro_dir(start: Path | None = None) -> Path | None:
    """Get .bpro/ path if it exists."""
    root = find_project_root(start)
    if root:
        return root / BPRO_DIR
    return None


def init_project(path: Path | None = None, force: bool = False) -> Path:
    """Initialize .bpro/ directory with default structure."""
    root = path or Path.cwd()
    bpro_path = root / BPRO_DIR

    if bpro_path.exists() and not force:
        raise FileExistsError(f".bpro/ already exists at {root}")

    bpro_path.mkdir(exist_ok=True)
    for subdir in SUBDIRS:
        (bpro_path / subdir).mkdir(exist_ok=True)

    config = DEFAULT_CONFIG.copy()
    config["project_name"] = root.name
    config["created"] = datetime.now(timezone.utc).isoformat()
    save_config(bpro_path, config)

    gitignore_path = bpro_path / ".gitignore"
    gitignore_path.write_text(GITIGNORE_CONTENT)

    return bpro_path


def load_config(bpro_path: Path) -> dict:
    """Load config.yaml from .bpro/."""
    config_path = bpro_path / CONFIG_FILE
    if not config_path.exists():
        return DEFAULT_CONFIG.copy()
    with open(config_path) as f:
        return yaml.safe_load(f) or DEFAULT_CONFIG.copy()


def save_config(bpro_path: Path, config: dict) -> None:
    """Save config.yaml to .bpro/."""
    config_path = bpro_path / CONFIG_FILE
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def load_specs(bpro_path: Path) -> list[dict]:
    """Load all REQ specs from .bpro/specs/."""
    specs_dir = bpro_path / "specs"
    reqs = []
    if not specs_dir.exists():
        return reqs
    for f in sorted(specs_dir.glob("REQ-*.yaml")):
        with open(f) as fh:
            req = yaml.safe_load(fh)
            if req:
                reqs.append(req)
    return reqs


def save_spec(bpro_path: Path, req: dict) -> None:
    """Save a single REQ spec to .bpro/specs/."""
    specs_dir = bpro_path / "specs"
    specs_dir.mkdir(exist_ok=True)
    filepath = specs_dir / f"{req['id']}.yaml"
    with open(filepath, "w") as f:
        yaml.dump(req, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def load_matrix(bpro_path: Path) -> dict:
    """Load traceability matrix."""
    matrix_path = bpro_path / "matrix" / "matrix.yaml"
    if not matrix_path.exists():
        return {}
    with open(matrix_path) as f:
        return yaml.safe_load(f) or {}


def save_matrix(bpro_path: Path, matrix: dict) -> None:
    """Save traceability matrix."""
    matrix_dir = bpro_path / "matrix"
    matrix_dir.mkdir(exist_ok=True)
    matrix_path = matrix_dir / "matrix.yaml"
    with open(matrix_path, "w") as f:
        yaml.dump(matrix, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
