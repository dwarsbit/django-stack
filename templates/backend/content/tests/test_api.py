"""
Smoke tests of the content API: every exposed model answers the read-only
key, drafts stay hidden, and the contact form takes submissions.
Run them with `pnpm test` at the project root.
"""

import pytest
from django.conf import settings
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
        {"name": "Ada", "email": "ada@example.com", "message": "Hello"},
        format="json",
    )
    assert response.status_code == 201
    assert FormSubmission.objects.filter(email="ada@example.com").exists()


def test_read_key_cannot_read_submissions(reader):
    assert reader.get("/api/content.formsubmission").status_code == 403
