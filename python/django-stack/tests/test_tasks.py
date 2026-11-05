from datetime import UTC, datetime, timedelta

import pytest

from django_stack import backup, tasks

NOW = datetime(2026, 11, 5, 3, 0, tzinfo=UTC)


def test_backup_due_at_the_hour_or_when_stale():
    assert tasks.backup_due(NOW, None, 3)
    assert tasks.backup_due(NOW, NOW - timedelta(hours=24), 3)
    assert not tasks.backup_due(NOW, NOW - timedelta(minutes=30), 3)
    assert not tasks.backup_due(NOW.replace(hour=10), NOW - timedelta(hours=7), 3)
    assert tasks.backup_due(NOW.replace(hour=10), NOW - timedelta(hours=26), 3)


@pytest.fixture
def daily(tmp_path, settings, monkeypatch):
    settings.DJANGO_STACK = {
        **settings.DJANGO_STACK,
        "BACKUP_DIR": str(tmp_path),
        "BACKUP_S3_BUCKET": None,
        "BACKUP_DAILY": True,
        "BACKUP_MEDIA": False,
    }
    made = []

    def fake_backup():
        name = backup.backup_name()
        (tmp_path / name).write_bytes(b"")
        made.append(name)
        return backup.Backup(name=name, path=tmp_path / name)

    monkeypatch.setattr(backup, "create_backup", fake_backup)
    return made


def test_daily_backup_catches_up_and_then_waits(daily):
    assert tasks.run_daily_backup(NOW.replace(hour=10))
    assert len(daily) == 1
    assert not tasks.run_daily_backup(datetime.now(UTC))
    assert len(daily) == 1


def test_daily_backup_is_off_by_default(daily, settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "BACKUP_DAILY": False}
    assert not tasks.run_daily_backup(NOW)
    assert daily == []
