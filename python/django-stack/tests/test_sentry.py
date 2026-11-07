from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

from django_stack import sentry
from django_stack.env import Env
from django_stack.logs import request_id
from django_stack.settings import configure

BASE_ENV = {"DJANGO_SECRET_KEY": "x" * 60}
DSN = "https://abc@o1.ingest.sentry.io/2"


def run(env):
    return configure({}, base_dir=Path("/srv/app"), env={**BASE_ENV, **env})


def test_options():
    options = sentry.sentry_options(Env({"SENTRY_DSN": DSN, "SENTRY_TRACES_SAMPLE_RATE": "0.1"}), "site")
    assert options["dsn"] == DSN
    assert options["environment"] == "production"
    assert options["send_default_pii"] is False
    assert options["traces_sample_rate"] == 0.1
    assert sentry.sentry_options(Env({}), "site") is None
    with pytest.raises(ImproperlyConfigured):
        sentry.sentry_options(Env({"SENTRY_DSN": DSN, "SENTRY_TRACES_SAMPLE_RATE": "2"}), "site")


def test_configure_starts_sentry_in_production_only(monkeypatch):
    started = []
    monkeypatch.setattr("sentry_sdk.init", lambda **options: started.append(options))
    s = run({"ERRORS": "sentry", "SENTRY_DSN": DSN})
    assert len(started) == 1
    assert s["DJANGO_STACK"]["ERRORS"] == "sentry"
    assert "errors" not in s["LOGGING"]["root"]["handlers"]
    run({"ERRORS": "sentry", "SENTRY_DSN": DSN, "DJANGO_DEBUG": "1"})
    run({"ERRORS": "sentry"})
    assert len(started) == 1


def test_events_carry_the_request_id():
    token = request_id.set("abc123")
    try:
        event = sentry._tag_request_id({}, None)
    finally:
        request_id.reset(token)
    assert event["tags"]["request_id"] == "abc123"
    assert sentry._tag_request_id({}, None) == {}
