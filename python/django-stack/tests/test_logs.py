import json
import logging
from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

from django_stack.logs import (
    JsonFormatter,
    PlainFormatter,
    QuietHeartbeatFilter,
    RequestIdFilter,
    request_id,
)
from django_stack.settings import configure

BASE_ENV = {"DJANGO_SECRET_KEY": "x" * 60}


def logging_for(env):
    return configure({}, base_dir=Path("/srv/app"), env={**BASE_ENV, **env})["LOGGING"]


def handler_formatter(settings):
    return settings["handlers"]["console"]["formatter"]


def test_json_in_production_and_plain_in_development():
    assert handler_formatter(logging_for({})) == "json"
    assert handler_formatter(logging_for({"DJANGO_DEBUG": "1"})) == "plain"
    assert handler_formatter(logging_for({"LOG_FORMAT": "plain"})) == "plain"


def test_access_log_only_in_production_by_default():
    assert logging_for({})["loggers"]["django_stack.access"]["level"] == "INFO"
    assert logging_for({"DJANGO_DEBUG": "1"})["loggers"]["django_stack.access"]["level"] == "WARNING"
    assert logging_for({"LOG_ACCESS": "0"})["loggers"]["django_stack.access"]["level"] == "WARNING"


def test_refuses_an_unknown_format():
    with pytest.raises(ImproperlyConfigured):
        logging_for({"LOG_FORMAT": "xml"})


def record(message="hello", **extra):
    rec = logging.LogRecord("app", logging.WARNING, __file__, 1, message, None, None)
    for key, value in extra.items():
        setattr(rec, key, value)
    RequestIdFilter().filter(rec)
    return rec


def test_json_line_has_the_request_id_and_extras():
    token = request_id.set("abc123")
    try:
        line = json.loads(JsonFormatter().format(record(status=404)))
    finally:
        request_id.reset(token)
    assert line["level"] == "WARNING"
    assert line["logger"] == "app"
    assert line["message"] == "hello"
    assert line["request_id"] == "abc123"
    assert line["status"] == 404
    assert line["time"].endswith("+00:00")


def test_json_line_has_the_exception():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        rec = record()
        rec.exc_info = sys.exc_info()
    line = json.loads(JsonFormatter().format(rec))
    assert "ValueError: boom" in line["exception"]
    assert "request_id" not in line


def test_plain_line_adds_the_request_id():
    formatter = PlainFormatter("{levelname} {name} {message}", style="{")
    assert formatter.format(record()) == "WARNING app hello"
    token = request_id.set("abc123")
    try:
        assert formatter.format(record()) == "WARNING app hello [abc123]"
    finally:
        request_id.reset(token)


@pytest.mark.django_db
def test_middleware_keeps_a_forwarded_id_and_logs_the_request(client, caplog):
    with caplog.at_level(logging.INFO, logger="django_stack.access"):
        response = client.get("/api/missing", headers={"X-Request-ID": "from-caddy-1"})
    assert response["X-Request-ID"] == "from-caddy-1"
    (line,) = [r for r in caplog.records if r.name == "django_stack.access"]
    assert line.status == response.status_code
    assert line.path == "/api/missing"
    assert line.request_id == "from-caddy-1"
    assert request_id.get() is None


@pytest.mark.django_db
def test_middleware_replaces_an_unsafe_id(client):
    response = client.get("/api/missing", headers={"X-Request-ID": "bad id\nINFO forged"})
    assert len(response["X-Request-ID"]) == 32


@pytest.mark.django_db
def test_health_checks_stay_out_of_the_access_log(client, caplog):
    with caplog.at_level(logging.INFO, logger="django_stack.access"):
        client.get("/healthz")
    assert not [r for r in caplog.records if r.name == "django_stack.access"]


def test_heartbeat_task_stays_out_of_the_log():
    quiet = QuietHeartbeatFilter()

    def huey(message, level=logging.INFO):
        return logging.LogRecord("huey.consumer.Worker", level, __file__, 1, message, None, None)

    assert not quiet.filter(huey("Executing django_stack.tasks.heartbeat: 1f2e"))
    assert quiet.filter(huey("Executing django_stack.tasks.daily_backup: 1f2e"))
    assert quiet.filter(huey("Unhandled exception in django_stack.tasks.heartbeat", logging.ERROR))
