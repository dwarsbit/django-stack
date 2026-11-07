from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache

from django_stack import errors, health
from django_stack.studio import RecentErrorsWidget, SystemLink, SystemPage, SystemStatusWidget


def request_for(**flags):
    return SimpleNamespace(user=SimpleNamespace(**{"is_active": True, "is_superuser": False, **flags}))


def test_system_page_is_for_superusers_only(settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "ERRORS": "email"}
    page, link = SystemPage(), SystemLink()
    assert page.path == "system/"
    assert link.url == "/system/"
    for extension in (page, link):
        assert extension.is_visible(request_for(is_superuser=True))
        assert not extension.is_visible(request_for())
    assert len(page.dashboard.widgets) == 2  # notifications are installed in the tests


@pytest.mark.django_db
def test_status_widget(settings, monkeypatch):
    settings.HUEY = {"immediate": False}
    monkeypatch.setattr(health, "_shared_cache", lambda: True)
    cache.delete(health.BACKUP_KEY)
    health.stamp(health.HEARTBEAT_KEY)
    rows = {row["title"]: row for row in SystemStatusWidget().get_data(None)["content"]}
    assert rows["Database"]["status_variant"] == "success"
    assert rows["Worker"]["status"] == "OK"
    assert rows["Worker"]["timestamp"] is not None
    assert rows["Daily backup"]["status"] == "Off"
    assert rows["Daily backup"]["timestamp"] is None


@pytest.mark.django_db
def test_recent_errors_widget(django_capture_on_commit_callbacks):
    from content_studio.notifications import notify

    admin = get_user_model().objects.create_superuser("root", "root@example.com", "pw")
    with django_capture_on_commit_callbacks(execute=True):
        for _ in range(2):
            notify(
                errors.EVENT,
                title="%(summary)s",
                body="%(logger)s",
                params={"summary": "ValueError: boom", "logger": "django.request"},
                level="error",
                recipients=[admin],
                key="abc",
            )
    data = RecentErrorsWidget().get_data(SimpleNamespace(user=admin))
    (row,) = data["content"]
    assert row["title"] == "ValueError: boom"
    assert row["description"] == "django.request"
    assert row["status"] == "2×"


def test_no_recent_errors_with_sentry(settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "ERRORS": "sentry"}
    assert len(SystemPage().dashboard.widgets) == 1
