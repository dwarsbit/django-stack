import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from content_studio.analytics.ranges import get_query
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError

from django_stack.analytics import UmamiProvider

WEBSITE_ID = "6f0c2d8e-3b1a-4c5d-9e7f-1a2b3c4d5e6f"
PASSWORD = "a-long-password"


class FakeUmami:
    """Umami's API as far as DjangoStack uses it."""

    def __init__(self):
        self.password = "umami"
        self.websites = {}
        self.tokens = set()
        self.calls = []

    def handle(self, method, path, body, token):
        self.calls.append((method, path))
        if path == "/api/heartbeat":
            return 200, {"ok": True}
        if path == "/api/auth/login":
            if body.get("username") != "admin" or body.get("password") != self.password:
                return 401, {"error": "unauthorized"}
            token = f"token-{len(self.tokens)}"
            self.tokens.add(token)
            return 200, {"token": token}
        if token not in self.tokens:
            return 401, {"error": "unauthorized"}
        if path == "/api/me/password":
            if body["currentPassword"] != self.password:
                return 400, {"error": "bad"}
            self.password = body["newPassword"]
            return 200, {}
        if path == "/api/websites" and method == "POST":
            self.websites[body["id"]] = {"id": body["id"], "name": body["name"], "domain": body["domain"]}
            return 200, self.websites[body["id"]]
        if path.startswith("/api/websites/"):
            website_id, _, endpoint = path.removeprefix("/api/websites/").partition("/")
            website_id = website_id.split("?")[0]
            if not endpoint and method == "GET":
                return 200, self.websites.get(website_id)
            if not endpoint and method == "POST":
                self.websites[website_id].update(body)
                return 200, self.websites[website_id]
            if endpoint.startswith("stats"):
                return 200, {"pageviews": 12, "visitors": 5, "visits": 6, "bounces": 3, "totaltime": 600}
        return 404, {"error": "not found"}


@pytest.fixture
def umami(settings):
    fake = FakeUmami()

    class Handler(BaseHTTPRequestHandler):
        def respond(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length)) if length else {}
            auth = self.headers.get("Authorization", "")
            status, data = fake.handle(self.command, self.path, body, auth.removeprefix("Bearer "))
            payload = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        do_GET = do_POST = respond

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    settings.DJANGO_STACK = {
        **settings.DJANGO_STACK,
        "UMAMI_URL": f"http://127.0.0.1:{server.server_port}",
        "UMAMI_WEBSITE_ID": WEBSITE_ID,
        "UMAMI_PASSWORD": PASSWORD,
    }
    settings.SITE_URL = "https://example.com"
    cache.clear()
    yield fake
    server.shutdown()


def test_setup_replaces_the_default_password_and_creates_the_website(umami):
    call_command("setup_umami", timeout=1)
    assert umami.password == PASSWORD
    assert umami.websites[WEBSITE_ID]["domain"] == "example.com"


def test_setup_is_idempotent_and_follows_the_domain(umami, settings):
    call_command("setup_umami", timeout=1)
    settings.SITE_URL = "https://www.example.org"
    call_command("setup_umami", timeout=1)
    assert umami.password == PASSWORD
    assert list(umami.websites) == [WEBSITE_ID]
    assert umami.websites[WEBSITE_ID]["domain"] == "www.example.org"


def test_setup_fails_on_an_unknown_password(umami):
    umami.password = "someone-elses"
    with pytest.raises(CommandError, match="refused UMAMI_ADMIN_PASSWORD"):
        call_command("setup_umami", timeout=1)


def test_setup_needs_umami_url(settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "UMAMI_URL": None}
    with pytest.raises(CommandError, match="UMAMI_URL"):
        call_command("setup_umami", timeout=1)


def test_provider_signs_in_and_reads_the_numbers(umami):
    call_command("setup_umami", timeout=1)
    assert UmamiProvider.is_configured()
    summary = UmamiProvider().get_summary(None, get_query("30d"))
    assert summary["pageviews"].value == 12
    assert summary["bounce_rate"].value == 50


def test_provider_signs_in_again_when_the_token_is_refused(umami):
    call_command("setup_umami", timeout=1)
    provider = UmamiProvider()
    provider.get_summary(None, get_query("30d"))
    umami.tokens.clear()
    assert provider.get_summary(None, get_query("7d"))["visitors"].value == 5


def test_provider_links_to_no_dashboard(umami):
    assert UmamiProvider().get_dashboard_url(None, get_query("30d")) is None


def test_not_configured_without_umami_url(settings):
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "UMAMI_URL": None}
    assert not UmamiProvider.is_configured()
