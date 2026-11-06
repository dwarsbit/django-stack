"""
The state of the site's services, for health checks and ``manage.py health``.

The worker stamps the cache every minute (``django_stack.tasks.heartbeat``)
and after each daily backup, so the backend and ``manage.py worker_alive``
can tell whether it runs and when it last backed up. Each check answers
``ok``, ``error`` or ``off`` (not used by this site).
"""

from __future__ import annotations

import time
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import connection

HEARTBEAT_KEY = "django_stack:health:worker"
BACKUP_KEY = "django_stack:health:backup"

#: The worker stamps the heartbeat every minute.
WORKER_STALE_AFTER = timedelta(minutes=3)
#: The backup runs daily; one hour of slack for a slow dump.
BACKUP_STALE_AFTER = timedelta(hours=26)
# Longer than any stale time, so a stamp is still there to be judged stale.
STAMP_TIMEOUT = int(timedelta(days=30).total_seconds())


def _shared_cache() -> bool:
    """Whether the cache is shared between containers (a local memory cache is per process)."""
    backend = settings.CACHES.get("default", {}).get("BACKEND", "")
    return not backend.endswith(("LocMemCache", "DummyCache"))


def tasks_on_worker() -> bool:
    """Whether a worker runs the tasks, rather than the request (TASKS_URL=immediate://)."""
    return not (getattr(settings, "HUEY", None) or {}).get("immediate", True)


def stamp(key: str, now: float | None = None) -> None:
    cache.set(key, time.time() if now is None else now, STAMP_TIMEOUT)


def age(key: str, now: float | None = None) -> timedelta | None:
    """How long ago ``key`` was stamped, or None when it never was."""
    value = cache.get(key)
    if value is None:
        return None
    return timedelta(seconds=max(0.0, (time.time() if now is None else now) - float(value)))


def check_database() -> str:
    try:
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return "ok"
    except Exception:  # noqa: BLE001
        return "error"


def check_cache() -> str:
    try:
        cache.set("django_stack:readyz", "1", 5)
        return "ok" if cache.get("django_stack:readyz") == "1" else "error"
    except Exception:  # noqa: BLE001
        return "error"


def check_worker(now: float | None = None) -> str:
    """``ok`` when the worker stamped its heartbeat in the last three minutes."""
    if not tasks_on_worker() or not _shared_cache():
        return "off"
    try:
        last = age(HEARTBEAT_KEY, now)
    except Exception:  # noqa: BLE001
        return "error"
    return "ok" if last is not None and last < WORKER_STALE_AFTER else "error"


def check_backup(now: float | None = None) -> str:
    """``ok`` when the last daily backup is less than 26 hours old; ``off`` before the first one."""
    if not tasks_on_worker() or not _shared_cache():
        return "off"
    try:
        last = age(BACKUP_KEY, now)
    except Exception:  # noqa: BLE001
        return "error"
    if last is None:
        return "off"
    return "ok" if last < BACKUP_STALE_AFTER else "error"


def ready() -> dict[str, str]:
    """What the backend needs to serve requests: the database and the cache."""
    return {"database": check_database(), "cache": check_cache()}


def status() -> dict[str, str]:
    """Every check: the database, the cache, the worker and the daily backup."""
    return {**ready(), "worker": check_worker(), "backup": check_backup()}


def healthy(checks: dict[str, str]) -> bool:
    return all(value != "error" for value in checks.values())
