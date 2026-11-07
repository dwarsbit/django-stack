"""
Tests of the site's pages: every route renders, drafts show only in
preview, a save empties the page cache, redirects work and the contact form
needs a captcha token. Run them with `{{pm_run}} test` at the project root.
"""

import pytest
from django.conf import settings
from django.core.cache import cache
from django.test import Client
from django_stack.contrib.captcha.testing import captcha_token
from django_stack.contrib.site.preview import PREVIEW_COOKIE
from django_stack.preview import make_preview_token

from content.models import FormSubmission, Page, Post
from content.seed import seed

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    cache.clear()
    seed()


@pytest.fixture
def client():
    return Client()


@pytest.mark.parametrize(
    "path", ["/", "/about", "/about/team", "/blog", "/blog?page=2", "/category/news", "/tag/django", "/contact"]
)
def test_pages_render(client, seeded, path):
    response = client.get(path)
    assert response.status_code == 200
    assert "<title>" in response.content.decode()
    assert "script-src 'self'" in response["Content-Security-Policy"]


def test_post(client, seeded):
    post = Post.objects.published().first()
    html = client.get(f"/blog/{post.slug}").content.decode()
    assert f"<h1>{post.title}</h1>" in html
    assert '<meta property="og:type" content="article">' in html


@pytest.mark.parametrize(
    ("path", "content_type"),
    [("/rss.xml", "application/rss+xml"), ("/sitemap.xml", "application/xml"), ("/robots.txt", "text/plain")],
)
def test_feeds(client, seeded, path, content_type):
    response = client.get(path)
    assert response.status_code == 200
    assert response["Content-Type"].startswith(content_type)
    assert settings.SITE_URL in response.content.decode()


def test_not_found_and_redirects(client, seeded):
    response = client.get("/does-not-exist")
    assert response.status_code == 404
    assert "Page not found" in response.content.decode()
    redirect = client.get("/old-about")
    assert redirect.status_code == 301
    assert redirect["Location"] == "/about"


def test_drafts_only_in_preview(client, seeded):
    assert Page.objects.filter(path="draft").exists()
    assert client.get("/draft").status_code == 404
    client.cookies[PREVIEW_COOKIE] = make_preview_token()
    response = client.get("/draft")
    assert response.status_code == 200
    assert "preview-banner" in response.content.decode()


def test_a_save_empties_the_page_cache(client, seeded):
    assert client.get("/about")["X-Cache"] == "MISS"
    assert client.get("/about")["X-Cache"] == "HIT"
    about = Page.objects.get(path="about")
    about.title = "Changed"
    about.save()
    response = client.get("/about")
    assert response["X-Cache"] == "MISS"
    assert "<h1>Changed</h1>" in response.content.decode()


def test_contact_form(client, seeded):
    data = {"name": "Ada", "email": "ada@example.com", "message": "Hello", "captcha": captcha_token()}
    response = client.post("/contact", data)
    assert response.status_code == 302
    assert FormSubmission.objects.filter(email="ada@example.com").exists()
    assert "Thank you" in client.get(response["Location"]).content.decode()


@pytest.mark.skipif(not settings.DJANGO_STACK["CAPTCHA"], reason="the captcha is off")
def test_contact_form_needs_a_captcha(client, seeded):
    response = client.post("/contact", {"name": "Ada", "email": "ada@example.com", "message": "Hello"})
    assert response.status_code == 400
    assert not FormSubmission.objects.exists()
