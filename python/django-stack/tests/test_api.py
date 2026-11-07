import json
from datetime import timedelta
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.utils import timezone

from django_stack.preview import make_preview_token
from django_stack.signing import verify_webhook
from tests.testapp.models import Article, Message

pytestmark = pytest.mark.django_db


@pytest.fixture
def articles():
    published = Article.objects.create(title="Live", slug="live", status="published")
    draft = Article.objects.create(title="Draft", slug="draft")
    scheduled = Article.objects.create(
        title="Later", slug="later", status="published", published_at=timezone.now() + timedelta(days=1)
    )
    return published, draft, scheduled


def slugs(response):
    return sorted(item["slug"] for item in response.json()["data"])


def test_routes_are_closed_without_a_key(client, articles):
    assert client.get("/api/testapp.article").status_code in (401, 403)


def test_read_key_sees_published_content_only(read_client, articles):
    response = read_client.get("/api/testapp.article")
    assert response.status_code == 200
    assert slugs(response) == ["live"]
    assert read_client.get("/api/testapp.article/by_slug/draft").status_code == 404


def test_read_key_cannot_write(read_client):
    assert read_client.post("/api/testapp.article", {"title": "x", "slug": "x"}).status_code == 403


def test_preview_token_shows_drafts(read_client, articles):
    response = read_client.get("/api/testapp.article", headers={"X-Preview-Token": make_preview_token()})
    assert slugs(response) == ["draft", "later", "live"]
    assert (
        read_client.get("/api/testapp.article", headers={"X-Preview-Token": "1.bad"}).json()["pagination"][
            "count"
        ]
        == 1
    )


def test_write_key_sees_everything(write_client, articles):
    assert slugs(write_client.get("/api/testapp.article")) == ["draft", "later", "live"]


def test_public_create(client, read_client, write_client, no_captcha):
    response = client.post("/api/testapp.message", {"email": "a@example.com", "text": "Hello"}, format="json")
    assert response.status_code == 201
    assert Message.objects.count() == 1
    # Nobody but the full-access key reads submissions.
    assert client.get("/api/testapp.message").status_code in (401, 403)
    assert read_client.get("/api/testapp.message").status_code == 403
    assert write_client.get("/api/testapp.message").status_code == 200
    # Public create does not allow changes.
    pk = Message.objects.get().pk
    assert client.delete(f"/api/testapp.message/{pk}").status_code in (401, 403)


def test_public_create_is_throttled(client, no_captcha):
    from django.core.cache import cache

    cache.clear()
    codes = [
        client.post(
            "/api/testapp.message", {"email": "a@example.com", "text": "Hi"}, format="json"
        ).status_code
        for _ in range(12)
    ]
    assert codes.count(201) == 10
    assert codes[-1] == 429


def test_media_and_blocks_are_serialized(read_client, settings, tmp_path):
    from content_studio.media_library.models import Media

    settings.MEDIA_ROOT = tmp_path
    media = Media.objects.create(
        name="Photo", alt_text="A photo", type="image", file=ContentFile(b"x", name="photo.jpg")
    )
    media.metadata = {"width": 800, "height": 600}
    media.save()
    Article.objects.create(
        title="With media",
        slug="media",
        status="published",
        cover=media,
        body=[
            {"id": "b1", "type": "text", "data": {"body": "Hello"}},
            {"id": "b2", "type": "image", "data": {"image": str(media.pk), "caption": "Caption"}},
        ],
    )
    data = read_client.get("/api/testapp.article/by_slug/media?expand=cover").json()
    assert data["cover"]["alt"] == "A photo"
    assert data["cover"]["width"] == 800
    assert data["cover"]["url"].startswith("http")
    assert data["body"][0] == {"id": "b1", "type": "text", "value": {"body": "Hello"}}
    assert data["body"][1]["value"]["image"]["id"] == str(media.pk)
    assert data["body"][1]["value"]["caption"] == "Caption"


def test_health(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["checks"] == {"database": "ok", "cache": "ok"}


def test_create_admin(settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "ADMIN_USERNAME": "boss", "ADMIN_PASSWORD": "pw-123456"}
    call_command("create_admin")
    call_command("create_admin")
    user = get_user_model().objects.get(username="boss")
    assert user.is_superuser and user.check_password("pw-123456")


def test_revalidate_on_content_changed(settings):
    from content_studio.signals import Change, content_changed

    settings.DJANGO_STACK = {
        **settings.DJANGO_STACK,
        "REVALIDATE_URL": "http://frontend:4321/api/revalidate",
        "REVALIDATE_SECRET": "hook-secret",
    }
    sent = {}

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout):
        sent["url"] = request.full_url
        sent["body"] = request.data
        sent["signature"] = request.get_header("X-django-stack-signature")
        return FakeResponse()

    change = Change(
        action="updated",
        model=Article,
        object_id="1",
        object_repr="Live",
        tenant_id=None,
        user=None,
        timestamp=timezone.now(),
    )
    with mock.patch("urllib.request.urlopen", fake_urlopen):
        content_changed.send(sender=None, changes=[change], user=None)

    assert sent["url"] == "http://frontend:4321/api/revalidate"
    assert json.loads(sent["body"])["changes"] == [
        {"action": "updated", "model": "testapp.article", "id": "1"}
    ]
    assert verify_webhook("hook-secret", sent["signature"], sent["body"])


def test_system_checks_pass():
    call_command("check", "--fail-level", "ERROR")
