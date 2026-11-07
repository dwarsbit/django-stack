"""
Error reports to Sentry (sentry.io), with ``ERRORS=sentry``.

``django_stack.settings.configure`` calls ``init_sentry`` when
``DJANGO_DEBUG=0`` and ``ERRORS=sentry``. It sends the errors of Django,
the Huey worker and every line logged at ``ERROR`` to the project of
``SENTRY_DSN``, tagged with the request ID of ``django_stack.logs``. No
personal data (user details, cookies, request bodies) is sent.
"""

from __future__ import annotations

import logging

from django.core.exceptions import ImproperlyConfigured

from .env import Env
from .logs import request_id

logger = logging.getLogger("django_stack.sentry")


def _tag_request_id(event, hint):
    rid = request_id.get()
    if rid:
        event.setdefault("tags", {})["request_id"] = rid
    return event


def sentry_options(e: Env, project_name: str) -> dict | None:
    """The options of ``sentry_sdk.init``, or None without ``SENTRY_DSN``."""
    dsn = e.str("SENTRY_DSN")
    if not dsn:
        return None
    try:
        traces = float(e.str("SENTRY_TRACES_SAMPLE_RATE", "0") or 0)
    except ValueError as error:
        raise ImproperlyConfigured("SENTRY_TRACES_SAMPLE_RATE must be a number from 0 to 1.") from error
    if not 0 <= traces <= 1:
        raise ImproperlyConfigured("SENTRY_TRACES_SAMPLE_RATE must be a number from 0 to 1.")
    return {
        "dsn": dsn,
        "environment": e.str("SENTRY_ENVIRONMENT", "production"),
        "release": e.str("SENTRY_RELEASE") or None,
        "server_name": project_name,
        "send_default_pii": False,
        "traces_sample_rate": traces,
        "before_send": _tag_request_id,
    }


def init_sentry(e: Env, project_name: str) -> bool:
    """Start the Sentry SDK. Returns False without ``SENTRY_DSN`` or without the SDK."""
    options = sentry_options(e, project_name)
    if options is None:
        logger.warning("ERRORS=sentry without SENTRY_DSN: errors are only logged.")
        return False
    try:
        import sentry_sdk
    except ImportError as error:
        raise ImproperlyConfigured(
            'ERRORS=sentry needs the Sentry SDK: depend on "django-stack[server]" or "sentry-sdk[django]".'
        ) from error
    from sentry_sdk.integrations.logging import ignore_logger

    sentry_sdk.init(**options)
    # Requests for a host that is not allowed: bots, never worth an event.
    ignore_logger("django.security.DisallowedHost")
    return True
