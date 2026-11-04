import logging
import subprocess
import time
from datetime import UTC, datetime, timedelta

from django.core.management.base import BaseCommand, CommandError

from django_stack import backup, conf

logger = logging.getLogger("django_stack.backup")


def next_run(at: str, now: datetime) -> datetime:
    """The next time of day ``at`` (HH:MM, UTC) after ``now``."""
    try:
        hour, minute = (int(part) for part in at.split(":"))
    except ValueError as error:
        raise CommandError(f"BACKUP_TIME must be HH:MM, not {at!r}.") from error
    run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return run if run > now else run + timedelta(days=1)


class Command(BaseCommand):
    help = "Back up the database every day at BACKUP_TIME (UTC). The backup service runs this."

    def handle(self, *args, **options):
        at = conf.get("BACKUP_TIME")
        while True:
            now = datetime.now(UTC)
            run = next_run(at, now)
            logger.info("Next backup at %s", run.isoformat())
            time.sleep((run - now).total_seconds())
            try:
                result = backup.create_backup()
                logger.info(
                    "Backed up the database to %s%s",
                    result.path,
                    " and the bucket" if result.uploaded else "",
                )
            except subprocess.CalledProcessError as error:
                logger.error("pg_dump failed: %s", error.stderr.decode(errors="replace").strip())
            except Exception:
                logger.exception("The backup failed")
