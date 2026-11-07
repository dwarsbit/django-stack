import logging
import sys
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured

from django_stack.errors import ErrorReportHandler, signature
from django_stack.settings import configure

BASE_ENV = {"DJANGO_SECRET_KEY": "x" * 60}


def logging_for(env):
    return configure({}, base_dir=Path("/srv/app"), env={**BASE_ENV, **env})["LOGGING"]


def test_reports_errors_in_production_only():
    assert "errors" in logging_for({})["root"]["handlers"]
    assert "errors" not in logging_for({"DJANGO_DEBUG": "1"})["root"]["handlers"]
    assert "errors" not in logging_for({"ERRORS": "off"})["root"]["handlers"]
    with pytest.raises(ImproperlyConfigured):
        logging_for({"ERRORS": "bugsnag"})


def failing_record(message="Internal Server Error: /api/x"):
    try:
        raise ValueError("boom")
    except ValueError:
        exc_info = sys.exc_info()
    return logging.LogRecord("django.request", logging.ERROR, __file__, 1, message, None, exc_info)


@pytest.fixture
def admin(db):
    cache.clear()
    return get_user_model().objects.create_superuser("root", "root@example.com", "pw")


def test_mails_the_superusers_and_notifies_them_once(admin, django_capture_on_commit_callbacks):
    from content_studio.notifications.models import Notification

    handler = ErrorReportHandler()
    with django_capture_on_commit_callbacks(execute=True):
        handler.emit(failing_record())
        handler.emit(failing_record())
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == ["root@example.com"]
    assert message.subject == "[test] ERROR: Internal Server Error: /api/x"
    assert "ValueError: boom" in message.body
    (notification,) = Notification.objects.filter(recipient=admin, event="system.error")
    assert notification.level == "error"


def test_error_email_overrides_the_recipients(admin, settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "ERROR_EMAIL": ["ops@example.com"]}
    ErrorReportHandler().emit(failing_record())
    assert mail.outbox[0].to == ["ops@example.com"]


def test_different_errors_are_reported_separately(admin):
    handler = ErrorReportHandler()
    handler.emit(failing_record())
    handler.emit(
        logging.LogRecord("django_stack.backup", logging.ERROR, __file__, 1, "pg_dump failed", None, None)
    )
    assert len(mail.outbox) == 2


def test_same_error_same_signature():
    assert signature(failing_record("a")) == signature(failing_record("b"))


def test_a_failing_report_does_not_raise(admin, monkeypatch):
    import django_stack.errors as errors

    def broken(*args):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(errors, "send_report", broken)
    ErrorReportHandler().emit(failing_record())
