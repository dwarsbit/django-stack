"""
The widgets of the admin dashboard (config/studio.py) answer with the
seeded content, and only to editors who may view it.
"""

import pytest
from content_studio.settings import cs_settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import RequestFactory
from rest_framework.exceptions import PermissionDenied

from content.dashboard import PublishedCountWidget, RecentSubmissionsWidget, SubmissionCountWidget
from content.models import Page

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded(settings, tmp_path):
    from content.seed import seed

    settings.MEDIA_ROOT = tmp_path
    seed()


def request_as(user):
    request = RequestFactory().get("/")
    request.user = user
    return request


@pytest.fixture
def admin():
    return get_user_model().objects.create_superuser("admin", "admin@example.com", "password")


def widget(cls):
    return next(w for w in cs_settings.ADMIN_SITE.dashboard.widgets if isinstance(w, cls))


def test_every_widget_answers_on_an_empty_site(admin):
    for item in cs_settings.ADMIN_SITE.dashboard.widgets:
        assert item.get_data(request_as(admin)) is not None


def test_no_submissions_yet(admin):
    data = widget(RecentSubmissionsWidget).get_data(request_as(admin))
    assert data["content"] == []
    assert data["description"].startswith("No messages yet.")
    assert data["view_all"] == "/content/content.formsubmission"


def test_every_widget_answers(seeded, admin):
    for item in cs_settings.ADMIN_SITE.dashboard.widgets:
        assert item.get_data(request_as(admin)) is not None


def test_counts_published_pages(seeded, admin):
    data = widget(PublishedCountWidget).get_data(request_as(admin))
    assert data["value"] == Page.objects.published().count()
    assert data["footnote"] == "1 draft"


def test_submissions(seeded, admin):
    assert widget(SubmissionCountWidget).get_data(request_as(admin))["value"] == 2
    rows = widget(RecentSubmissionsWidget).get_data(request_as(admin))["content"]
    assert [row["title"] for row in rows] == ["Alan Visitor", "Grace Reader"]


def test_submissions_need_the_view_permission(seeded):
    editor = get_user_model().objects.create_user("editor", "editor@example.com", "password", is_staff=True)
    with pytest.raises(PermissionDenied):
        widget(RecentSubmissionsWidget).get_data(request_as(editor))
    editor.user_permissions.add(Permission.objects.get(codename="view_formsubmission"))
    editor = get_user_model().objects.get(pk=editor.pk)
    assert len(widget(RecentSubmissionsWidget).get_data(request_as(editor))["content"]) == 2
