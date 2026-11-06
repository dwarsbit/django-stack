import time

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from django_stack import health, tasks

WORKER = {"huey_class": "huey.MemoryHuey", "immediate": False}


@pytest.fixture
def worker(settings, monkeypatch):
    settings.HUEY = WORKER
    monkeypatch.setattr(health, "_shared_cache", lambda: True)


def test_worker_and_backup_are_off_without_a_worker(settings):
    settings.HUEY = {"immediate": True}
    assert health.check_worker() == "off"
    assert health.check_backup() == "off"


def test_worker_and_backup_are_off_with_a_local_memory_cache(settings):
    settings.HUEY = WORKER
    assert health.check_worker() == "off"


def test_worker_heartbeat(worker):
    from django.core.cache import cache

    cache.delete(health.HEARTBEAT_KEY)
    assert health.check_worker() == "error"
    tasks.heartbeat.call_local()
    assert health.check_worker() == "ok"
    assert health.check_worker(now=time.time() + 600) == "error"


def test_backup_age(worker):
    from django.core.cache import cache

    cache.delete(health.BACKUP_KEY)
    assert health.check_backup() == "off"
    health.stamp(health.BACKUP_KEY)
    assert health.check_backup() == "ok"
    assert health.check_backup(now=time.time() + 27 * 3600) == "error"


@pytest.mark.django_db
def test_statusz_fails_when_the_worker_stopped(worker, client):
    from django.core.cache import cache

    cache.delete(health.HEARTBEAT_KEY)
    response = client.get("/statusz")
    assert response.status_code == 503
    assert response.json()["checks"]["worker"] == "error"
    health.stamp(health.HEARTBEAT_KEY)
    assert client.get("/statusz").json() == {
        "status": "ok",
        "checks": {"database": "ok", "cache": "ok", "worker": "ok", "backup": "off"},
    }


@pytest.mark.django_db
def test_readyz_ignores_the_worker(worker, client):
    from django.core.cache import cache

    cache.delete(health.HEARTBEAT_KEY)
    assert client.get("/readyz").status_code == 200


@pytest.mark.django_db
def test_commands(worker):
    from django.core.cache import cache

    cache.delete(health.HEARTBEAT_KEY)
    with pytest.raises(CommandError):
        call_command("worker_alive")
    with pytest.raises(CommandError, match="worker"):
        call_command("health")
    health.stamp(health.HEARTBEAT_KEY)
    call_command("worker_alive")
    call_command("health")


def test_backup_ping(settings, monkeypatch):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "BACKUP_PING_URL": "https://hc.example.com/abc"}
    opened = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(
        tasks.urllib.request, "urlopen", lambda url, timeout: opened.append(url) or Response()
    )
    tasks.ping_backup()
    assert opened == ["https://hc.example.com/abc"]
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "BACKUP_PING_URL": "file:///etc/passwd"}
    tasks.ping_backup()
    assert len(opened) == 1
