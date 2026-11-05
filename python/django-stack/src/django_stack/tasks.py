"""
The daily backup as a Huey periodic task, run by the worker.

The task runs every hour at the minute of ``BACKUP_TIME`` (UTC) and backs
up when it is the hour of ``BACKUP_TIME``, or when the newest backup is
older than a day: that catches up a backup missed while the server or the
worker was down. The worker also checks once when it starts. It only runs where
``BACKUP_DAILY`` is on, which the production worker sets.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from huey import crontab
from huey.contrib.djhuey import db_periodic_task, lock_task, on_startup

from . import backup, conf

logger = logging.getLogger("django_stack.backup")

#: A backup older than this is due, whatever the time.
STALE_AFTER = timedelta(hours=25)


def _backup_time() -> tuple[int, int]:
    value = conf.get("BACKUP_TIME") or "03:00"
    try:
        hour, minute = (int(part) for part in value.split(":"))
    except ValueError:
        logger.error("BACKUP_TIME must be HH:MM, not %r; using 03:00.", value)
        return 3, 0
    return hour, minute


def newest_backup_time() -> datetime | None:
    """The time of the newest database backup, in the volume or the bucket."""
    names = backup.local_backups()
    try:
        names += backup.remote_backups()
    except Exception:
        logger.exception("Could not list the backup bucket")
    stamps = [backup.NAME_PATTERN.match(name)["stamp"] for name in names]
    if not stamps:
        return None
    return datetime.strptime(max(stamps), "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)


def backup_due(now: datetime, newest: datetime | None, hour: int) -> bool:
    """Whether to back up now: at the hour of BACKUP_TIME, or when the newest backup is stale."""
    if newest is None or now - newest >= STALE_AFTER:
        return True
    return now.hour == hour and now - newest > timedelta(hours=1)


def run_daily_backup(now: datetime | None = None) -> bool:
    """Back up the database and the media when due. Returns whether it backed up."""
    if not conf.get("BACKUP_DAILY"):
        return False
    now = now or datetime.now(UTC)
    hour, _ = _backup_time()
    if not backup_due(now, newest_backup_time(), hour):
        return False
    result = backup.create_backup()
    logger.info("Backed up the database to %s%s", result.path, " and the bucket" if result.uploaded else "")
    if backup.media_backups_enabled():
        media = backup.create_media_backup(result.name)
        logger.info("Backed up the media to %s%s", media.path, " and the bucket" if media.uploaded else "")
    return True


@db_periodic_task(crontab(minute=str(_backup_time()[1])), retries=3, retry_delay=600)
@lock_task("django-stack-backup")
def daily_backup():
    run_daily_backup()


@on_startup("django-stack-backup-catch-up")
def catch_up_backup():
    """When the worker starts, queue the backup; it only runs when one is due."""
    if conf.get("BACKUP_DAILY"):
        daily_backup()
