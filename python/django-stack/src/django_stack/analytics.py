"""
Page analytics from the Umami that runs in the project's Compose file.

Django Content Studio shows the numbers: its ``AnalyticsExtension``,
``AnalyticsPage`` and analytics widgets read them through a provider.
``UmamiProvider`` here is Content Studio's Umami provider for that bundled
Umami: it signs in with the admin password from ``UMAMI_ADMIN_PASSWORD``
instead of an API key, and links to no Umami dashboard, because Umami's own
interface is not served::

    # config/studio.py
    from content_studio.analytics import AnalyticsExtension, AnalyticsLink, AnalyticsPage
    from django_stack.analytics import UmamiProvider

    extensions = []
    if UmamiProvider.is_configured():
        extensions += [AnalyticsExtension(provider=UmamiProvider()), AnalyticsPage(), AnalyticsLink()]

``manage.py setup_umami`` prepares Umami on the backend's start: it
replaces the default admin password and creates the site's website.
"""

from __future__ import annotations

import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from content_studio.analytics import AnalyticsError
from content_studio.analytics.umami import UmamiProvider as ContentStudioUmamiProvider
from django.core.cache import cache

from . import conf

__all__ = ["UmamiClient", "UmamiError", "UmamiProvider"]

# The password Umami gives its admin user on the first start.
DEFAULT_PASSWORD = "umami"  # noqa: S105 - Umami's published default, replaced on setup
TOKEN_TIMEOUT = 12 * 3600


class UmamiError(Exception):
    """Umami could not be reached or refused a request; ``status`` is its HTTP status, if any."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class UmamiClient:
    """The few calls of Umami's API that DjangoStack makes, with a bearer token."""

    timeout = 5

    def __init__(self, url: str, token: str | None = None):
        self.url = url.rstrip("/")
        self.token = token

    def call(self, method: str, path: str, body: dict | None = None):
        headers = {"Accept": "application/json", "User-Agent": "django-stack"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(self.url + path, data=data, headers=headers, method=method)  # noqa: S310 - UMAMI_URL
        try:
            with urlopen(request, timeout=self.timeout) as response:  # noqa: S310
                text = response.read().decode()
        except HTTPError as error:
            raise UmamiError(f"Umami answered {error.code} to {method} {path}.", error.code) from error
        except (URLError, TimeoutError, OSError) as error:
            raise UmamiError(f"Umami at {self.url} could not be reached: {error}.") from error
        try:
            return json.loads(text) if text else None
        except ValueError as error:
            raise UmamiError(f"Umami sent no JSON for {method} {path}.") from error

    def wait(self, timeout: float = 120) -> None:
        """Wait until Umami answers, or raise UmamiError after ``timeout`` seconds."""
        deadline = time.monotonic() + timeout
        while True:
            try:
                self.call("GET", "/api/heartbeat")
                return
            except UmamiError:
                if time.monotonic() > deadline:
                    raise
                time.sleep(2)

    def login(self, username: str, password: str) -> str:
        """Sign in and use the token for the next calls."""
        self.token = None
        data = self.call("POST", "/api/auth/login", {"username": username, "password": password})
        token = (data or {}).get("token")
        if not token:
            raise UmamiError("Umami sent no token after signing in.")
        self.token = token
        return token


class UmamiProvider(ContentStudioUmamiProvider):
    """
    Content Studio's Umami provider for the bundled Umami, from the
    ``UMAMI_URL``, ``UMAMI_WEBSITE_ID`` and ``UMAMI_ADMIN_PASSWORD``
    settings. It signs in as Umami's admin and keeps the token in the cache.
    """

    def __init__(self, website_id: str = None, url: str = None, username: str = None, password: str = None):
        super().__init__(
            website_id=website_id or conf.get("UMAMI_WEBSITE_ID"),
            url=url or conf.get("UMAMI_URL"),
        )
        self.username = username or conf.get("UMAMI_USERNAME")
        self.password = password or conf.get("UMAMI_PASSWORD")

    @staticmethod
    def is_configured() -> bool:
        """Whether the settings name a bundled Umami: ``UMAMI_URL`` and ``UMAMI_WEBSITE_ID``."""
        return bool(conf.get("UMAMI_URL") and conf.get("UMAMI_WEBSITE_ID"))

    def token(self, refresh: bool = False) -> str:
        key = f"django_stack:umami:token:{self.url}:{self.username}"
        token = None if refresh else cache.get(key)
        if not token:
            if not self.password:
                raise AnalyticsError("Set UMAMI_ADMIN_PASSWORD to read the analytics from Umami.")
            try:
                token = UmamiClient(self.url).login(self.username, self.password)
            except UmamiError as error:
                raise AnalyticsError(f"Signing in to Umami failed: {error}") from error
            cache.set(key, token, TOKEN_TIMEOUT)
        return token

    def request(self, request, endpoint, params=None):
        self.api_key = self.token()
        try:
            return super().request(request, endpoint, params)
        except AnalyticsError as error:
            # A token from before Umami's APP_SECRET changed: sign in again, once.
            if getattr(error.__cause__, "code", None) != 401:
                raise
            self.api_key = self.token(refresh=True)
            return super().request(request, endpoint, params)

    def get_dashboard_url(self, request, query):
        # Umami's interface is internal: there is nothing to link to.
        return None

    def check(self):
        warnings = []
        if not self.password:
            warnings.append(("django_stack.W006", "UMAMI_URL is set but UMAMI_ADMIN_PASSWORD is not."))
        if not self.website_id:
            warnings.append(("django_stack.W006", "UMAMI_URL is set but UMAMI_WEBSITE_ID is not."))
        return warnings
