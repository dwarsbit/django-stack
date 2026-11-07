import hashlib
import re
from base64 import b64encode
from pathlib import Path

import pytest
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.template import Context, Template
from django.test import Client, RequestFactory

from django_stack.contrib.captcha.forms import CAPTCHA_CSP, CAPTCHA_STYLE_HASH
from django_stack.contrib.captcha.pow import solve
from django_stack.contrib.site import clear_site_cache, in_preview, published
from django_stack.contrib.site.cache import content_security_policy, media_origins
from django_stack.contrib.site.preview import PREVIEW_COOKIE
from django_stack.contrib.site.views import local_path
from django_stack.preview import make_preview_token
from tests.testapp import views
from tests.testapp.models import Article, Redirect

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def empty_cache():
    cache.clear()


@pytest.fixture
def client(settings):
    # Static URLs without a manifest from collectstatic.
    settings.STORAGES = {
        **settings.STORAGES,
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
    return Client()


@pytest.fixture
def articles():
    Article.objects.create(
        title="Live",
        slug="live",
        status="published",
        body=[
            {"id": "b1", "type": "text", "data": {"body": "Hello"}},
            {"id": "b2", "type": "unknown", "data": {}},
        ],
    )
    Article.objects.create(title="Draft", slug="draft")


def preview_client():
    client = Client()
    client.cookies[PREVIEW_COOKIE] = make_preview_token()
    return client


def test_published_matches_the_api(articles):
    request = RequestFactory().get("/")
    assert [a.slug for a in published(Article.objects.all(), request)] == ["live"]
    request.COOKIES[PREVIEW_COOKIE] = make_preview_token()
    assert in_preview(request)
    assert sorted(a.slug for a in published(Article.objects.all(), request)) == ["draft", "live"]
    request.COOKIES[PREVIEW_COOKIE] = "1.forged"
    assert not in_preview(request)


def test_page_renders_blocks_and_seo(client, articles):
    response = client.get("/blog/live")
    html = response.content.decode()
    assert response.status_code == 200
    assert "<title>Live | Test site</title>" in html
    assert '<link rel="canonical" href="http://testserver/blog/live">' in html
    assert '<meta property="og:type" content="article">' in html
    assert '<div class="text">Hello</div>' in html
    assert "unknown" not in html
    assert "preview-banner" not in html
    assert "script-src 'self';" in response["Content-Security-Policy"]
    assert "wasm-unsafe-eval" not in response["Content-Security-Policy"]


def test_drafts_only_in_preview(client, articles):
    assert client.get("/blog/draft").status_code == 404
    response = preview_client().get("/blog/draft")
    assert response.status_code == 200
    assert "preview-banner" in response.content.decode()
    assert response["Cache-Control"] == "private, no-store"


def test_preview_route_sets_the_cookie(client):
    token = make_preview_token()
    response = client.get("/preview", {"token": token, "path": "/blog/draft"})
    assert response.status_code == 302
    assert response["Location"] == "/blog/draft"
    cookie = response.cookies[PREVIEW_COOKIE]
    assert cookie.value == token
    assert cookie["httponly"]
    assert client.get("/preview", {"token": "1.forged"}).status_code == 401
    exit_response = client.get("/preview/exit")
    assert exit_response["Location"] == "/"
    assert exit_response.cookies[PREVIEW_COOKIE].value == ""


def test_preview_redirects_only_to_this_site():
    assert local_path("/about") == "/about"
    assert local_path("//evil.example") == "/"
    assert local_path("/\\evil.example") == "/"
    assert local_path("https://evil.example") == "/"
    assert local_path(None) == "/"


def test_pages_are_cached_until_content_changes(client, articles):
    views.calls["article"] = 0
    assert client.get("/blog/live")["X-Cache"] == "MISS"
    hit = client.get("/blog/live")
    assert hit["X-Cache"] == "HIT"
    assert "Hello" in hit.content.decode()
    assert hit["Content-Security-Policy"]
    assert views.calls["article"] == 1

    article = Article.objects.get(slug="live")
    article.title = "Changed"
    article.save()
    response = client.get("/blog/live")
    assert response["X-Cache"] == "MISS"
    assert "<h1>Changed</h1>" in response.content.decode()


def test_changes_outside_the_content_keep_the_cache(client, articles):
    client.get("/blog/live")
    Redirect.objects.create(old_path="/x", new_path="/y")  # testapp is a content app
    assert client.get("/blog/live")["X-Cache"] == "MISS"
    from django.contrib.auth import get_user_model

    get_user_model().objects.create(username="someone")
    assert client.get("/blog/live")["X-Cache"] == "HIT"


def test_clear_site_cache(client, articles):
    client.get("/blog/live")
    clear_site_cache()
    assert client.get("/blog/live")["X-Cache"] == "MISS"


def test_no_cache_in_preview_or_debug(client, settings, articles):
    preview = preview_client()
    preview.get("/blog/live")
    assert "X-Cache" not in preview.get("/blog/live")
    settings.DEBUG = True
    assert "X-Cache" not in client.get("/blog/live")


def test_redirects_for_missing_paths(client, articles):
    Redirect.objects.create(old_path="/old", new_path="/blog/live", permanent=True)
    Redirect.objects.create(old_path="/moved", new_path="https://example.com/", permanent=False)
    Redirect.objects.create(old_path="/blog/live", new_path="/elsewhere")
    response = client.get("/old/")
    assert response.status_code == 301
    assert response["Location"] == "/blog/live"
    assert client.get("/moved")["Location"] == "https://example.com/"
    assert client.get("/moved").status_code == 302
    # An existing page wins over a redirect.
    assert client.get("/blog/live").status_code == 200
    assert client.get("/nothing").status_code == 404


def test_contact_form_needs_a_captcha(client, settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "CAPTCHA_CHALLENGES": 3, "CAPTCHA_DIFFICULTY": 2}
    page = client.get("/contact")
    html = page.content.decode()
    assert '<cap-widget id="id_captcha" data-cap-api-endpoint="/api/cap/"' in html
    assert 'src="/static/django_stack/captcha/loader.js" defer' in html
    assert "X-Cache" not in page
    csp = page["Content-Security-Policy"]
    assert "'wasm-unsafe-eval'" in csp and CAPTCHA_STYLE_HASH in csp and "worker-src 'self' blob:" in csp

    missing = client.post("/contact", {"email": "a@example.com"})
    assert "Verify that you are human." in missing.content.decode()
    challenge = client.post("/api/cap/challenge").json()
    c, s, d = challenge["challenge"]["c"], challenge["challenge"]["s"], challenge["challenge"]["d"]
    redeemed = client.post(
        "/api/cap/redeem",
        {"token": challenge["token"], "solutions": solve(challenge["token"], c, s, d)},
        content_type="application/json",
    ).json()
    sent = client.post("/contact", {"email": "a@example.com", "captcha": redeemed["token"]})
    assert "errorlist" not in sent.content.decode()
    # A token is valid once.
    again = client.post("/contact", {"email": "a@example.com", "captcha": redeemed["token"]})
    assert "not valid or has expired" in again.content.decode()


def test_contact_form_without_captcha(client, no_captcha):
    assert "cap-widget" not in client.get("/contact").content.decode()
    assert "errorlist" not in client.post("/contact", {"email": "a@example.com"}).content.decode()


def test_vendored_widget_matches_the_style_hash():
    # The widget sets its shadow root to <style>CSS</style>; the hash is of the CSS.
    import django_stack.contrib.captcha as captcha

    source = (Path(captcha.__file__).parent / "static/django_stack/captcha/cap.min.js").read_text()
    tag = source.index("innerHTML=`<style${")
    start = source.index('""}>', tag) + 4
    css = source[start : source.index("</style>", start)]
    assert css.startswith(":host{")
    digest = b64encode(hashlib.sha256(css.encode()).digest()).decode()
    assert f"'sha256-{digest}'" == CAPTCHA_STYLE_HASH
    assert CAPTCHA_STYLE_HASH in CAPTCHA_CSP["style-src"]


def test_media_origins_in_the_policy(settings):
    settings.MEDIA_URL = "https://cdn.example.com/media/"
    assert media_origins() == ["https://cdn.example.com"]
    assert "img-src 'self' data: https://cdn.example.com;" in content_security_policy()
    settings.MEDIA_URL = "/media/"
    assert "img-src 'self' data:;" in content_security_policy()


def render(source, **context):
    return Template("{% load stack %}" + source).render(Context(context))


def test_image_tag(settings, tmp_path):
    from content_studio.media_library.models import Media

    settings.MEDIA_ROOT = tmp_path
    media = Media.objects.create(
        name="Photo", alt_text="A photo", type="image", file=ContentFile(b"x", name="p.jpg")
    )
    media.metadata = {"width": 800, "height": 600}
    media.properties = {"focal_point": {"x": 30, "y": 60}}
    media.save()
    html = render('{% image media size="nope" eager=True class_name="cover" %}', media=media)
    assert html.startswith('<img src="http')
    assert 'alt="A photo"' in html and 'width="800"' in html and 'height="600"' in html
    assert 'class="cover"' in html and 'loading="eager"' in html
    assert 'style="object-position: 30% 60%"' in html
    assert render('{% image media alt="" %}', media=media).count('alt=""') == 1
    assert render("{% image None %}") == ""
    serialized = {"url": "/a.jpg", "sizes": {"card": {"url": "/c.jpg", "width": 400, "height": 300}}}
    html = render('{% image media size="card" sizes="50vw" %}', media=serialized)
    assert 'src="/c.jpg"' in html and 'srcset="/c.jpg 400w"' in html and 'sizes="50vw"' in html


def test_link_filters():
    class Page:
        def get_absolute_url(self):
            return "/about"

    assert render("{{ item|link_href }}", item={"value": {"page": Page(), "url": ""}}) == "/about"
    assert render("{{ item|link_href }}", item={"value": {"page": None, "url": "https://x.example"}}) == (
        "https://x.example"
    )
    assert render("{{ item|link_href }}", item={"value": {"page": None, "url": ""}}) == "/"
    assert render("{{ '/blog'|is_current:'/blog/post' }}") == "True"
    assert render("{{ '/'|is_current:'/blog' }}") == "False"
    assert render("{{ '/blog'|is_current:'/blog' }}") == "True"


def test_seo_falls_back_to_the_site():
    html = render(
        "{% seo page site %}",
        page={"title": "About", "seo_description": ""},
        site={"site_name": "Site", "seo_description": "The site"},
        request=RequestFactory().get("/about"),
    )
    assert "<title>About | Site</title>" in html
    assert '<meta name="description" content="The site">' in html
    assert '<meta name="twitter:card" content="summary">' in html
    assert re.search(r'<meta property="og:site_name" content="Site">', html)


def test_analytics_proxy(client, settings, monkeypatch):
    import io
    import urllib.request

    from django_stack.contrib.site import analytics

    assert client.get("/_a/script.js").status_code == 404  # no UMAMI_URL
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "UMAMI_URL": "http://umami:3000"}
    seen = []

    class Answer(io.BytesIO):
        status = 200
        headers = {"Content-Type": "application/javascript"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_urlopen(request, timeout):
        seen.append(request)
        return Answer(b"tracker")

    monkeypatch.setattr(analytics.urllib.request, "urlopen", fake_urlopen)
    response = client.get("/_a/script.js", HTTP_USER_AGENT="Browser")
    assert response.content == b"tracker"
    assert seen[0].full_url == "http://umami:3000/script.js"
    assert seen[0].get_header("User-agent") == "Browser"
    client.post("/_a/api/send", b'{"type":"event"}', content_type="application/json")
    assert seen[1].full_url == "http://umami:3000/api/send"
    assert seen[1].data == b'{"type":"event"}'
    assert client.get("/_a/api/send").status_code == 405
    assert isinstance(seen[0], urllib.request.Request)
