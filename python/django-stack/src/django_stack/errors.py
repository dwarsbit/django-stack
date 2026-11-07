"""
Error reports: an email and an admin notification for each new error.

With ``ERRORS=email`` (the default) and ``DJANGO_DEBUG=0``,
``django_stack.settings.configure`` adds ``ErrorReportHandler`` to the
logging setup. Every line logged at ``ERROR`` or above, such as a server
error (500), a failed task of the worker or a failed backup, is mailed to
``ERROR_EMAIL`` (or, without it, to the active superusers with an email
address) and, with Content Studio's notifications app installed, shows as
a "Server errors" notification of the superusers in the admin. The same
error is reported once an hour at most; a notification of an error that
repeats counts up instead of adding a line.
"""

from __future__ import annotations

import hashlib
import logging
import threading
import traceback

REPEAT_SECONDS = 3600
EVENT = "system.error"

_local = threading.local()


def signature(record: logging.LogRecord) -> str:
    """The same error gives the same signature: the logger, the exception type and where it was raised."""
    parts = [record.name]
    if record.exc_info and record.exc_info[0]:
        kind, _, tb = record.exc_info
        parts.append(kind.__qualname__)
        frames = traceback.extract_tb(tb)
        if frames:
            parts.append(f"{frames[-1].filename}:{frames[-1].lineno}")
    else:
        parts.append(str(record.msg))
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:20]


def summary(record: logging.LogRecord) -> str:
    message = record.getMessage().splitlines()[0] if record.getMessage() else ""
    if record.exc_info and record.exc_info[1] is not None:
        error = record.exc_info[1]
        message = message or f"{type(error).__name__}: {error}".splitlines()[0]
    return message[:150]


def superusers():
    from django.contrib.auth import get_user_model

    return get_user_model()._default_manager.filter(is_superuser=True, is_active=True)


def recipients() -> list[str]:
    from django.contrib.auth import get_user_model

    from . import conf

    configured = conf.get("ERROR_EMAIL") or []
    if configured:
        return list(configured)
    field = get_user_model().get_email_field_name()
    return sorted({email for email in superusers().values_list(field, flat=True) if email})


def register_event() -> None:
    """The notification event of the superusers, when Content Studio's notifications app is installed."""
    from content_studio.notifications import register_event as register
    from django.utils.translation import gettext_lazy as _

    register(
        EVENT,
        _("Server errors"),
        _("An error in the backend, the worker or a backup. Sent to superusers."),
        level="error",
    )


def send_report(record: logging.LogRecord, formatted: str) -> None:
    from django.apps import apps
    from django.conf import settings
    from django.core.mail import send_mail

    text = summary(record)
    rid = getattr(record, "request_id", None)
    to = recipients()
    if to:
        project = getattr(settings, "PROJECT_NAME", "django-stack")
        body = f"{formatted}\n\nLogger: {record.name}\n" + (f"Request ID: {rid}\n" if rid else "")
        send_mail(f"[{project}] {record.levelname}: {text}", body, None, to)
    if apps.is_installed("content_studio.notifications"):
        from content_studio.notifications import notify

        notify(
            EVENT,
            title="%(summary)s",
            body="%(logger)s",
            params={"summary": text, "logger": record.name},
            level="error",
            recipients=superusers(),
            key=signature(record),
        )


class ErrorReportHandler(logging.Handler):
    """Reports each new error once an hour by email and as an admin notification. See the module."""

    def emit(self, record: logging.LogRecord) -> None:
        if getattr(_local, "busy", False) or record.name.startswith("django_stack.errors"):
            return
        _local.busy = True
        try:
            from django.core.cache import cache

            if not cache.add(f"django_stack:error:{signature(record)}", 1, REPEAT_SECONDS):
                return
            send_report(record, self.format(record))
        except Exception:  # noqa: BLE001 - a report must never break the request
            logging.getLogger("django_stack.errors").warning("Could not report an error", exc_info=True)
        finally:
            _local.busy = False
