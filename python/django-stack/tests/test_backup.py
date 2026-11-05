import subprocess
import tarfile
from datetime import UTC, datetime

import pytest
from django.core.exceptions import ImproperlyConfigured

from django_stack import backup
from django_stack.management.commands.run_backups import next_run

POSTGRES = {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": "app",
    "USER": "app",
    "PASSWORD": "secret",
    "HOST": "db.example.com",
    "PORT": 5433,
    "OPTIONS": {"sslmode": "require"},
}


@pytest.fixture
def backups(tmp_path, settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "BACKUP_DIR": str(tmp_path), "BACKUP_S3_BUCKET": None}
    return tmp_path


def test_pg_environment():
    env = backup.pg_environment(POSTGRES)
    assert env["PGHOST"] == "db.example.com"
    assert env["PGPORT"] == "5433"
    assert env["PGPASSWORD"] == "secret"
    assert env["PGSSLMODE"] == "require"


def test_backup_name(settings):
    settings.PROJECT_NAME = "my site"
    assert backup.backup_name(datetime(2026, 11, 4, 3, 0, tzinfo=UTC)) == "my-site-20261104T030000Z.dump"


def test_prune_keeps_the_newest(backups):
    names = [f"site-2026110{day}T030000Z.dump" for day in range(1, 6)]
    for name in [*names, "notes.txt"]:
        (backups / name).write_bytes(b"")
    removed = backup.prune(2)
    assert removed == names[:3]
    assert sorted(path.name for path in backups.iterdir()) == ["notes.txt", *names[3:]]


def test_create_backup_runs_pg_dump(backups, monkeypatch):
    calls = []

    def fake_run(args, env, check, capture_output):
        calls.append((args, env))
        path = args[args.index("--file") + 1]
        with open(path, "wb") as file:
            file.write(b"dump")

    monkeypatch.setattr(backup.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(backup, "_database", lambda: POSTGRES)
    result = backup.create_backup(keep=5)
    assert result.path.read_bytes() == b"dump"
    assert result.path.parent == backups
    assert not result.uploaded
    args, env = calls[0]
    assert args[0] == "/usr/bin/pg_dump"
    assert env["PGDATABASE"] == "app"


def test_backups_need_postgres(backups):
    with pytest.raises(ImproperlyConfigured):
        backup.pg_environment()


def test_fetch_backup(backups):
    (backups / "site-20261101T030000Z.dump").write_bytes(b"")
    assert backup.fetch_backup("site-20261101T030000Z.dump") == backups / "site-20261101T030000Z.dump"
    with pytest.raises(FileNotFoundError):
        backup.fetch_backup("site-20261102T030000Z.dump")


def test_next_run():
    now = datetime(2026, 11, 4, 2, 30, tzinfo=UTC)
    assert next_run("03:00", now) == datetime(2026, 11, 4, 3, 0, tzinfo=UTC)
    assert next_run("02:00", now) == datetime(2026, 11, 5, 2, 0, tzinfo=UTC)


@pytest.fixture
def media(tmp_path, settings, backups):
    root = tmp_path / "media-root"
    (root / "images").mkdir(parents=True)
    (root / "images" / "a.jpg").write_bytes(b"a")
    (root / "b.pdf").write_bytes(b"b")
    settings.MEDIA_ROOT = str(root)
    disk = {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    settings.STORAGES = {**settings.STORAGES, "default": disk}
    return root


def test_media_name():
    assert backup.media_name("site-20261104T030000Z.dump") == "site-20261104T030000Z.media.tar.gz"


def test_media_backup_and_restore(media, backups):
    result = backup.create_media_backup("site-20261104T030000Z.dump", keep=5)
    assert result.path == backups / "site-20261104T030000Z.media.tar.gz"
    assert backup.local_backups(backup.MEDIA_PATTERN) == [result.name]
    assert backup.local_backups() == []

    (media / "b.pdf").unlink()
    (media / "new.txt").write_bytes(b"new")
    backup.restore_media(backup.fetch_backup(result.name))
    files = sorted(str(path.relative_to(media)) for path in media.rglob("*"))
    assert files == ["b.pdf", "images", "images/a.jpg"]
    assert (media / "images" / "a.jpg").read_bytes() == b"a"


def test_broken_media_archive_changes_nothing(media, tmp_path):
    broken = tmp_path / "broken.media.tar.gz"
    broken.write_bytes(b"not a tar")
    with pytest.raises(tarfile.ReadError):
        backup.restore_media(broken)
    assert (media / "b.pdf").exists()
    assert not (media / ".restoring").exists()


def test_media_retention_is_separate(media, backups):
    for day in range(1, 4):
        (backups / f"site-2026110{day}T030000Z.dump").write_bytes(b"")
        backup.create_media_backup(f"site-2026110{day}T030000Z.dump", keep=2)
    assert backup.local_backups(backup.MEDIA_PATTERN) == [
        "site-20261102T030000Z.media.tar.gz",
        "site-20261103T030000Z.media.tar.gz",
    ]
    assert len(backup.local_backups()) == 3


def test_media_backups_only_on_disk(media, settings):
    assert backup.media_backups_enabled()
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "BACKUP_MEDIA": False}
    assert not backup.media_backups_enabled()
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "BACKUP_MEDIA": True}
    settings.STORAGES = {**settings.STORAGES, "default": {"BACKEND": "storages.backends.s3.S3Storage"}}
    assert not backup.media_backups_enabled()
