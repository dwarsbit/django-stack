"""Tell the frontend which content changed, so it can purge its cache."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from ... import conf
from ...signing import sign_webhook

logger = logging.getLogger("django_stack.revalidate")

try:  # Django 6.0+
    from django.tasks import task
except ImportError:  # pragma: no cover - Django 5.2 with or without django-tasks
    try:
        from django_tasks import task
    except ImportError:
        task = None


def send_revalidate(changes: list[dict]) -> bool:
    """POST the changes to REVALIDATE_URL, signed with REVALIDATE_SECRET."""
    url = conf.get("REVALIDATE_URL")
    secret = conf.get("REVALIDATE_SECRET")
    if not url or not secret:
        return False

    body = json.dumps({"version": 1, "event": "content.changed", "changes": changes}).encode()
    request = urllib.request.Request(  # noqa: S310 - the URL is the project's own setting
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "django-stack",
            "X-Django-Stack-Signature": sign_webhook(secret, body),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=conf.get("REVALIDATE_TIMEOUT")) as response:  # noqa: S310
            ok = 200 <= response.status < 300
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        logger.warning("Revalidation request to %s failed: %s", url, error)
        return False
    if not ok:
        logger.warning("Revalidation request to %s answered %s", url, response.status)
    return ok


if task is not None:

    @task()
    def revalidate(changes: list[dict]) -> bool:
        """The task the worker runs: one revalidation request."""
        return send_revalidate(changes)

else:  # pragma: no cover
    revalidate = None


def enqueue_revalidate(changes: list[dict]) -> None:
    if revalidate is not None:
        try:
            revalidate.enqueue(changes)
            return
        except Exception as error:  # noqa: BLE001 - fall back to sending in the request
            logger.warning("Could not enqueue the revalidation task: %s", error)
    send_revalidate(changes)
