"""
Backups: the database with ``pg_dump`` and, when uploads are stored on
disk, the media directory as a ``.tar.gz``, to a directory and, optionally,
to a private S3 bucket, with retention.

The ``backup`` service of a project runs ``run_backups``, which calls
:func:`create_backup` and :func:`create_media_backup` once a day.
``backup_database`` makes them now, ``restore_database`` and
``restore_media`` restore them.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tarfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

from . import conf

NAME_PATTERN = re.compile(r"^(?P<prefix>.+)-(?P<stamp>\d{8}T\d{6}Z)\.dump$")
MEDIA_PATTERN = re.compile(r"^(?P<prefix>.+)-(?P<stamp>\d{8}T\d{6}Z)\.media\.tar\.gz$")
MEDIA_SUFFIX = ".media.tar.gz"


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


def media_name(database_name: str) -> str:
    """The media archive that belongs to a database dump: same name and time."""
    return database_name.removesuffix(".dump") + MEDIA_SUFFIX


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


def create_backup(*, keep: int | None = None, name: str | None = None) -> Backup:
    """Dump the database, upload it when a backup bucket is set, and apply the retention."""
    pg_dump = shutil.which("pg_dump")
    if pg_dump is None:
        raise ImproperlyConfigured("pg_dump is not installed; install the Postgres client.")
    directory = backup_dir()
    name = name or backup_name()
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

    _upload(backup)
    prune(keep if keep is not None else conf.get("BACKUP_KEEP"))
    return backup


def _upload(backup: Backup) -> None:
    target = _s3_target()
    if target:
        bucket, prefix = target
        s3_client().upload_file(str(backup.path), bucket, f"{prefix}{backup.name}")
        backup.uploaded = True


def media_on_disk() -> bool:
    """Whether uploads are stored in MEDIA_ROOT, not in S3: only then the media needs a backup."""
    backend = settings.STORAGES.get("default", {}).get("BACKEND", "")
    return backend == "django.core.files.storage.FileSystemStorage"


def media_backups_enabled() -> bool:
    return bool(conf.get("BACKUP_MEDIA")) and media_on_disk()


def create_media_backup(database_name: str, *, keep: int | None = None) -> Backup:
    """Archive MEDIA_ROOT next to a database dump, upload it, and apply the retention."""
    root = Path(settings.MEDIA_ROOT)
    name = media_name(database_name)
    path = backup_dir() / name
    partial = path.with_name(f"{name}.partial")
    with tarfile.open(partial, "w:gz") as archive:
        if root.is_dir():
            for entry in sorted(root.iterdir()):
                if not entry.name.startswith(".restoring"):
                    archive.add(entry, arcname=entry.name)
    partial.rename(path)
    path.chmod(0o600)
    backup = Backup(name=name, path=path)
    _upload(backup)
    prune(keep if keep is not None else conf.get("BACKUP_KEEP"), pattern=MEDIA_PATTERN)
    return backup


def _sorted_names(names, pattern: re.Pattern = NAME_PATTERN) -> list[str]:
    return sorted(
        (name for name in names if pattern.match(name)),
        key=lambda name: pattern.match(name)["stamp"],
    )


def local_backups(pattern: re.Pattern = NAME_PATTERN) -> list[str]:
    return _sorted_names((path.name for path in backup_dir().iterdir()), pattern)


def remote_backups(pattern: re.Pattern = NAME_PATTERN) -> list[str]:
    target = _s3_target()
    if not target:
        return []
    bucket, prefix = target
    names = []
    for page in s3_client().get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        names += [item["Key"][len(prefix) :] for item in page.get("Contents", [])]
    return _sorted_names(names, pattern)


def prune(keep: int, pattern: re.Pattern = NAME_PATTERN) -> list[str]:
    """Delete all but the ``keep`` newest backups of a kind, locally and in the bucket."""
    removed = []
    if keep is None or keep <= 0:
        return removed
    for name in local_backups(pattern)[:-keep]:
        (backup_dir() / name).unlink(missing_ok=True)
        removed.append(name)
    target = _s3_target()
    if target:
        bucket, prefix = target
        client = s3_client()
        for name in remote_backups(pattern)[:-keep]:
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
    if target and (NAME_PATTERN.match(path.name) or MEDIA_PATTERN.match(path.name)):
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


def restore_media(path: Path) -> None:
    """Replace the contents of MEDIA_ROOT with a media archive."""
    root = Path(settings.MEDIA_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    # Extract next to the current files first, so a broken archive changes nothing.
    staging = root / ".restoring"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    try:
        with tarfile.open(path, "r:gz") as archive:
            archive.extractall(staging, filter="data")
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    for entry in root.iterdir():
        if entry == staging:
            continue
        if entry.is_dir() and not entry.is_symlink():
            shutil.rmtree(entry)
        else:
            entry.unlink()
    for entry in staging.iterdir():
        entry.rename(root / entry.name)
    staging.rmdir()
