"""
Logging: JSON lines, request IDs and one access log line per request.

``django_stack.settings.configure`` sets ``LOGGING`` with these classes;
``LOG_FORMAT`` picks ``json`` (the default without ``DJANGO_DEBUG``) or
``plain``. ``RequestIdMiddleware`` gives every request an ID, from the
``X-Request-ID`` header Caddy sets or a new one, returns it in the
response's ``X-Request-ID`` header, adds it to every log line written
while the request runs, and writes the access log line on the
``django_stack.access`` logger::

    # config/settings.py
    MIDDLEWARE = [
        "django_stack.logs.RequestIdMiddleware",
        "django.middleware.security.SecurityMiddleware",
        ...
    ]
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime

from asgiref.sync import iscoroutinefunction, markcoroutinefunction

request_id: ContextVar[str | None] = ContextVar("django_stack_request_id", default=None)

access_logger = logging.getLogger("django_stack.access")

HEADER = "X-Request-ID"
# A forwarded ID is kept only when it is short and plain, so it cannot
# break a log line.
VALID_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}")
# Health checks run every few seconds; their lines would bury the rest.
QUIET_PATHS = frozenset({"/healthz", "/readyz"})

# The attributes every LogRecord has; anything else came from `extra`.
_RECORD_ATTRS = frozenset(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "request_id",
    "taskName",
}


class RequestIdFilter(logging.Filter):
    """Sets ``record.request_id`` to the ID of the request being handled, or None."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = request_id.get()
        return True


class QuietHeartbeatFilter(logging.Filter):
    """Drops Huey's lines about the worker's heartbeat task, which runs every minute."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not record.name.startswith("huey") or record.levelno > logging.INFO:
            return True
        return "django_stack.tasks.heartbeat" not in record.getMessage()


class JsonFormatter(logging.Formatter):
    """One JSON object per line: time, level, logger, message, request ID, extras, exception."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        rid = getattr(record, "request_id", None)
        if rid:
            entry["request_id"] = rid
        for key, value in vars(record).items():
            if key not in _RECORD_ATTRS and not key.startswith("_"):
                entry[key] = value
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        elif record.exc_text:
            entry["exception"] = record.exc_text
        if record.stack_info:
            entry["stack"] = self.formatStack(record.stack_info)
        return json.dumps(entry, default=str, ensure_ascii=False)


class PlainFormatter(logging.Formatter):
    """``LEVEL logger message``, with the request ID in brackets when there is one."""

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        rid = getattr(record, "request_id", None)
        return f"{line} [{rid}]" if rid and "\n" not in line else line


def new_request_id(request) -> str:
    forwarded = request.headers.get(HEADER, "")
    return forwarded if VALID_ID.fullmatch(forwarded) else uuid.uuid4().hex


def _log_access(request, response, started: float) -> None:
    if request.path in QUIET_PATHS and response.status_code < 400:
        return
    user = getattr(request, "user", None)
    access_logger.info(
        "%s %s %s",
        request.method,
        request.get_full_path(),
        response.status_code,
        extra={
            "method": request.method,
            "path": request.path,
            "status": response.status_code,
            "duration_ms": round((time.monotonic() - started) * 1000, 1),
            "user_id": getattr(user, "pk", None) if getattr(user, "is_authenticated", False) else None,
        },
    )


class RequestIdMiddleware:
    """Gives each request an ID for its log lines and writes its access log line. Put it first."""

    sync_capable = True
    async_capable = True

    def __init__(self, get_response):
        self.get_response = get_response
        self.is_async = iscoroutinefunction(get_response)
        if self.is_async:
            markcoroutinefunction(self)

    def __call__(self, request):
        if self.is_async:
            return self.__acall__(request)
        rid = new_request_id(request)
        token = request_id.set(rid)
        request.request_id = rid
        started = time.monotonic()
        try:
            response = self.get_response(request)
            response[HEADER] = rid
            _log_access(request, response, started)
            return response
        finally:
            request_id.reset(token)

    async def __acall__(self, request):
        rid = new_request_id(request)
        token = request_id.set(rid)
        request.request_id = rid
        started = time.monotonic()
        try:
            response = await self.get_response(request)
            response[HEADER] = rid
            _log_access(request, response, started)
            return response
        finally:
            request_id.reset(token)


def logging_settings(log_format: str, level: str, *, access: bool = True) -> dict:
    """The LOGGING setting for ``LOG_FORMAT`` and ``LOG_LEVEL``; ``access`` writes the access log."""
    formatter = "json" if log_format == "json" else "plain"
    handler = ["console"]
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "request_id": {"()": "django_stack.logs.RequestIdFilter"},
            "quiet_heartbeat": {"()": "django_stack.logs.QuietHeartbeatFilter"},
        },
        "formatters": {
            "plain": {
                "()": "django_stack.logs.PlainFormatter",
                "format": "{levelname} {name} {message}",
                "style": "{",
            },
            "json": {"()": "django_stack.logs.JsonFormatter"},
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": formatter,
                "filters": ["request_id", "quiet_heartbeat"],
            }
        },
        "root": {"handlers": handler, "level": level},
        "loggers": {
            "django": {"handlers": handler, "level": "INFO", "propagate": False},
            "django_stack.access": {"level": "INFO" if access else "WARNING"},
            # runserver's own access log; the production server has none.
            "django.server": {"handlers": handler, "level": "INFO", "propagate": False},
            # run_huey adds a handler of its own unless the logger has one.
            "huey": {"handlers": handler, "level": "INFO", "propagate": False},
        },
    }
