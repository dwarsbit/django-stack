"""
Database backups: ``pg_dump`` to a directory and, optionally, to a private
S3 bucket, with retention.

The ``backup`` service of a project runs ``run_backups``, which calls
:func:`create_backup` once a day. ``backup_database`` makes one now and
``restore_database`` restores one.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from . import conf

NAME_PATTERN = re.compile(r"^(?P<prefix>.+)-(?P<stamp>\d{8}T\d{6}Z)\.dump$")


@dataclass
class Backup:
    name: str
    path: Path
    uploaded: bool = False


def _database() -> dict:
    database = settings.DATABASES["default"]
    if "postgresql" not in database["ENGINE"]:
        raise ImproperlyConfigured("Backups need a Postgres database; DATABASE_URL is not postgres://.")
    return database


def pg_environment(database: dict | None = None) -> dict[str, str]:
    """The environment for pg_dump and pg_restore: connection values as PG* variables."""
    database = database or _database()
    env = dict(os.environ)
    values = {
        "PGHOST": database.get("HOST") or "localhost",
        "PGPORT": str(database.get("PORT") or 5432),
        "PGUSER": database.get("USER") or "",
        "PGPASSWORD": database.get("PASSWORD") or "",
        "PGDATABASE": database.get("NAME") or "",
    }
    sslmode = (database.get("OPTIONS") or {}).get("sslmode")
    if sslmode:
        values["PGSSLMODE"] = sslmode
    env.update({key: value for key, value in values.items() if value})
    return env


def backup_dir() -> Path:
    path = Path(conf.get("BACKUP_DIR") or Path(settings.BASE_DIR) / "backups")
    path.mkdir(parents=True, exist_ok=True)
    return path


def backup_name(now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    prefix = re.sub(r"[^a-zA-Z0-9_-]+", "-", getattr(settings, "PROJECT_NAME", "") or "backup")
    return f"{prefix}-{now.strftime('%Y%m%dT%H%M%SZ')}.dump"


def s3_client():
    """A boto3 client for the backup bucket, with the S3_* credentials."""
    import boto3

    options = conf.get("BACKUP_S3") or {}
    return boto3.client(
        "s3",
        endpoint_url=options.get("endpoint_url"),
        region_name=options.get("region_name"),
        aws_access_key_id=options.get("access_key"),
        aws_secret_access_key=options.get("secret_key"),
    )


def _s3_target() -> tuple[str, str] | None:
    bucket = conf.get("BACKUP_S3_BUCKET")
    if not bucket:
        return None
    prefix = (conf.get("BACKUP_S3_PREFIX") or "").strip("/")
    return bucket, f"{prefix}/" if prefix else ""


def create_backup(*, keep: int | None = None) -> Backup:
    """Dump the database, upload it when a backup bucket is set, and apply the retention."""
    pg_dump = shutil.which("pg_dump")
    if pg_dump is None:
        raise ImproperlyConfigured("pg_dump is not installed; install the Postgres client.")
    directory = backup_dir()
    name = backup_name()
    path = directory / name
    partial = path.with_suffix(".partial")
    subprocess.run(  # noqa: S603 (fixed arguments, no shell)
        [pg_dump, "--format=custom", "--no-owner", "--no-acl", "--file", str(partial)],
        env=pg_environment(),
        check=True,
        capture_output=True,
    )
    partial.rename(path)
    path.chmod(0o600)
    backup = Backup(name=name, path=path)

    target = _s3_target()
    if target:
        bucket, prefix = target
        s3_client().upload_file(str(path), bucket, f"{prefix}{name}")
        backup.uploaded = True

    prune(keep if keep is not None else conf.get("BACKUP_KEEP"))
    return backup


def _sorted_names(names) -> list[str]:
    return sorted(
        (name for name in names if NAME_PATTERN.match(name)),
        key=lambda name: NAME_PATTERN.match(name)["stamp"],
    )


def local_backups() -> list[str]:
    return _sorted_names(path.name for path in backup_dir().iterdir())


def remote_backups() -> list[str]:
    target = _s3_target()
    if not target:
        return []
    bucket, prefix = target
    names = []
    for page in s3_client().get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        names += [item["Key"][len(prefix) :] for item in page.get("Contents", [])]
    return _sorted_names(names)


def prune(keep: int) -> list[str]:
    """Delete all but the ``keep`` newest backups, locally and in the bucket."""
    removed = []
    if keep is None or keep <= 0:
        return removed
    for name in local_backups()[:-keep]:
        (backup_dir() / name).unlink(missing_ok=True)
        removed.append(name)
    target = _s3_target()
    if target:
        bucket, prefix = target
        client = s3_client()
        for name in remote_backups()[:-keep]:
            client.delete_object(Bucket=bucket, Key=f"{prefix}{name}")
            removed.append(f"s3://{bucket}/{prefix}{name}")
    return removed


def fetch_backup(name: str) -> Path:
    """The path of a local backup, downloading it from the bucket when it is only there."""
    path = Path(name)
    if path.is_file():
        return path
    local = backup_dir() / path.name
    if local.is_file():
        return local
    target = _s3_target()
    if target and NAME_PATTERN.match(path.name):
        bucket, prefix = target
        s3_client().download_file(bucket, f"{prefix}{path.name}", str(local))
        return local
    raise FileNotFoundError(f"No backup named {name} in {backup_dir()} or the backup bucket.")


def restore_backup(path: Path) -> None:
    """Restore a dump over the current database: objects in the dump are dropped and recreated."""
    pg_restore = shutil.which("pg_restore")
    if pg_restore is None:
        raise ImproperlyConfigured("pg_restore is not installed; install the Postgres client.")
    subprocess.run(  # noqa: S603 (fixed arguments, no shell)
        [
            pg_restore,
            "--clean",
            "--if-exists",
            "--no-owner",
            "--no-acl",
            "--single-transaction",
            "--dbname",
            _database()["NAME"],
            str(path),
        ],
        env=pg_environment(),
        check=True,
        capture_output=True,
    )
