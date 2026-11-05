"""Set the DjangoStack version everywhere it is recorded.

Usage: python scripts/bump_version.py X.Y.Z[-(alpha|beta|rc).N]

Every package shares one version: the four npm packages under packages/
and the django-stack PyPI package. Updates their package.json,
pyproject.toml, __init__.py and uv.lock, the minimum versions the
templates install, and dates the "## X.Y.Z (unreleased)" heading in
CHANGELOG.md (which must exist).
"""

import datetime
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$")
NPM_PACKAGES = ["cli", "utils", "react", "next"]
PEP440_PRE = {"alpha": "a", "beta": "b", "rc": "rc"}


def pep440(version):
    """1.2.0-rc.1 (npm) is 1.2.0rc1 for Python."""
    return re.sub(r"-(alpha|beta|rc)\.(\d+)$", lambda m: PEP440_PRE[m[1]] + m[2], version)


def replace(path, pattern, repl, count=1):
    file = ROOT / path
    text = file.read_text()
    new, n = re.subn(pattern, repl, text, count=count, flags=re.MULTILINE)
    if n != count:
        sys.exit(f"Expected {count} match(es) for {pattern!r} in {path}, found {n}")
    file.write_text(new)


def main(version):
    if not VERSION_RE.match(version):
        sys.exit(f"Invalid version {version!r}: expected X.Y.Z or X.Y.Z-rc.N")

    # The changelog first: a missing heading fails before any file changes.
    today = datetime.date.today().isoformat()
    replace(
        "CHANGELOG.md",
        rf"^## {re.escape(version)} \(unreleased\)$",
        f"## {version} ({today})",
    )

    for name in NPM_PACKAGES:
        replace(
            f"packages/{name}/package.json",
            r'^  "version": ".*",$',
            f'  "version": "{version}",',
        )

    py_version = pep440(version)
    python = "python/django-stack"
    replace(f"{python}/pyproject.toml", r'^version = ".*"$', f'version = "{py_version}"')
    replace(
        f"{python}/src/django_stack/__init__.py",
        r'^__version__ = ".*"$',
        f'__version__ = "{py_version}"',
    )
    replace(
        f"{python}/uv.lock",
        r'^(name = "django-stack"\nversion = )".*"$',
        rf'\g<1>"{py_version}"',
    )

    # New projects require the version they were generated with.
    replace(
        "templates/backend/pyproject.toml",
        r'"django-stack\[([a-z0-9,]+)\]>=[^"]*"',
        rf'"django-stack[\g<1>]>={py_version}"',
    )
    replace(
        "templates/frontend-astro/package.json",
        r'"@django-stack/utils": "[^"]*"',
        f'"@django-stack/utils": "^{version}"',
    )
    print(f"Version set to {version}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
