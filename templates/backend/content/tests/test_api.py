"""
Smoke tests of the content API: every exposed model answers the read-only
key, drafts stay hidden, and the contact form takes submissions.
Run them with `{{pm_run}} test` at the project root.
"""

import pytest
from django.apps import apps
from django.conf import settings
from django_stack.contrib.captcha.testing import captcha_token
from rest_framework.test import APIClient

from content.models import FormSubmission, Page, Post
from content.seed import seed

pytestmark = pytest.mark.django_db

ROUTES = [
    "content.page",
    "content.post",
    "content.category",
    "content.tag",
    "content.author",
    "content.menu",
    "content.redirect",
    "content.sitesettings",
    "content_studio_media_library.media",
]


@pytest.fixture
def reader():
    return APIClient(headers={"X-Secret-Key": settings.HEADLESS["AUTH_READ_ONLY_SECRET_KEY"]})


@pytest.fixture
def seeded(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    seed()


@pytest.mark.parametrize("route", ROUTES)
def test_read_key_reads_every_model(reader, seeded, route):
    assert reader.get(f"/api/{route}").status_code == 200


def test_api_is_closed_without_a_key(seeded):
    assert APIClient().get("/api/content.page").status_code in (401, 403)


def test_drafts_are_hidden(reader, seeded):
    assert Page.objects.filter(slug="draft").exists()
    assert reader.get("/api/content.page?path=draft").json()["data"] == []
    assert reader.get("/api/content.page?path=about/team").json()["data"][0]["title"] == "Team"


def test_post_by_slug(reader, seeded):
    post = Post.objects.first()
    data = reader.get(f"/api/content.post/by_slug/{post.slug}?expand=cover,author").json()
    assert data["title"] == post.title
    assert data["cover"]["url"]


def test_contact_form(seeded):
    response = APIClient().post(
        "/api/content.formsubmission",
        {"name": "Ada", "email": "ada@example.com", "message": "Hello", "captcha": captcha_token()},
        format="json",
    )
    assert response.status_code == 201
    assert FormSubmission.objects.filter(email="ada@example.com").exists()


@pytest.mark.skipif(not settings.DJANGO_STACK["CAPTCHA"], reason="the captcha is off")
def test_contact_form_needs_a_captcha(seeded):
    response = APIClient().post(
        "/api/content.formsubmission",
        {"name": "Ada", "email": "ada@example.com", "message": "Hello"},
        format="json",
    )
    assert response.status_code == 400
    assert "captcha" in response.json()


@pytest.mark.skipif(not apps.is_installed("content_studio.notifications"), reason="notifications are off")
def test_contact_form_notifies_the_editors(seeded, django_capture_on_commit_callbacks):
    from content_studio.notifications.models import Notification
    from django.contrib.auth import get_user_model

    editor = get_user_model().objects.create_superuser("editor", "editor@example.com", "x")
    with django_capture_on_commit_callbacks(execute=True):
        APIClient().post(
            "/api/content.formsubmission",
            {"name": "Ada", "email": "ada@example.com", "message": "100% sure", "captcha": captcha_token()},
            format="json",
        )
    notification = Notification.objects.get(recipient=editor, event="site.form_submitted")
    assert notification.get_title() == "Message from Ada"
    assert notification.get_body() == "100% sure"


def test_read_key_cannot_read_submissions(reader):
    assert reader.get("/api/content.formsubmission").status_code == 403
