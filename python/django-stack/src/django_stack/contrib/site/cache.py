"""
The page cache of a site Django renders, and its Content-Security-Policy.

Pages are kept in Django's cache (``CACHES["default"]``: the database cache
by default, so every process shares it) for ``SITE_CACHE_TTL`` seconds, and
all of them are emptied when content changes: the cache key holds a
version that ``clear_site_cache()`` replaces.
"""

from __future__ import annotations

import functools
import hashlib
import secrets
from urllib.parse import urlsplit

from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse

from ... import conf
from .preview import in_preview

VERSION_KEY = "django_stack_site:version"
CACHEABLE_TYPES = ("text/html", "application/xml", "application/rss+xml", "text/plain")


def cache_version() -> str:
    version = cache.get(VERSION_KEY)
    if version is None:
        # A new random version, never an old one: a lost key must not bring back old pages.
        cache.add(VERSION_KEY, secrets.token_hex(8), None)
        version = cache.get(VERSION_KEY) or ""
    return version


def clear_site_cache() -> None:
    """Empties the page cache: every page renders again on its next visit."""
    cache.set(VERSION_KEY, secrets.token_hex(8), None)


def page_key(request) -> str:
    digest = hashlib.sha256(request.get_full_path().encode()).hexdigest()
    return f"django_stack_site:page:{cache_version()}:{digest}"


def media_origins() -> list[str]:
    """The origins media files come from when they are not on this site: S3 or a CDN."""
    origins = []
    urls = [settings.MEDIA_URL]
    storage = settings.STORAGES.get("default", {}) if hasattr(settings, "STORAGES") else {}
    if "s3" in storage.get("BACKEND", "").lower():
        urls.append(storage.get("OPTIONS", {}).get("endpoint_url"))
    for url in urls:
        parts = urlsplit(url or "")
        if parts.scheme in ("http", "https") and parts.netloc:
            origin = f"{parts.scheme}://{parts.netloc}"
            if origin not in origins:
                origins.append(origin)
    return origins


def content_security_policy(*, captcha: bool = False) -> str:
    """
    Scripts and styles only from this site, images from this site and the
    media origins, and with ``captcha`` what the captcha widget needs.
    """
    from ..captcha.forms import CAPTCHA_CSP

    media = " ".join(media_origins())
    script = ["'self'", *(CAPTCHA_CSP["script-src"] if captcha else ())]
    style = ["'self'", *(CAPTCHA_CSP["style-src"] if captcha else ())]
    worker = CAPTCHA_CSP["worker-src"] if captcha else ("'self'",)
    directives = [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        f"script-src {' '.join(script)}",
        f"style-src {' '.join(style)}",
        # Inline style attributes, such as the focal point of an image.
        "style-src-attr 'unsafe-inline'",
        f"img-src 'self' data: {media}".rstrip(),
        f"media-src 'self' {media}".rstrip(),
        f"worker-src {' '.join(worker)}",
    ]
    return "; ".join(directives)


def _cacheable(request, response) -> bool:
    content_type = response.get("Content-Type", "")
    return (
        response.status_code == 200
        and not response.streaming
        and content_type.startswith(CACHEABLE_TYPES)
        and not response.cookies
        # A page with a CSRF token belongs to one visitor.
        and not request.META.get("CSRF_COOKIE_NEEDS_UPDATE")
    )


def site_page(view=None, *, cache_page: bool = True, captcha: bool = False):
    """
    A view of the site: its pages are cached until content changes (not in
    preview, not with DEBUG on, not for pages with a form), and it gets the
    site's Content-Security-Policy, with what the captcha widget needs when
    ``captcha`` is on.

        @site_page
        def post(request, slug): ...

        @site_page(cache_page=False, captcha=True)
        def contact(request): ...
    """
    if view is None:
        return functools.partial(site_page, cache_page=cache_page, captcha=captcha)

    @functools.wraps(view)
    def wrapper(request, *args, **kwargs):
        preview = in_preview(request)
        ttl = conf.get("SITE_CACHE_TTL")
        use_cache = (
            cache_page and ttl and request.method in ("GET", "HEAD") and not preview and not settings.DEBUG
        )
        key = page_key(request) if use_cache else None
        if key:
            hit = cache.get(key)
            if hit is not None:
                status, content, headers = hit
                response = HttpResponse(content, status=status)
                for name, value in headers:
                    response[name] = value
                response["X-Cache"] = "HIT"
                return response

        response = view(request, *args, **kwargs)
        if hasattr(response, "render") and callable(response.render):
            response = response.render()
        if not response.has_header("Content-Security-Policy"):
            response["Content-Security-Policy"] = content_security_policy(captcha=captcha)
        if preview:
            response["Cache-Control"] = "private, no-store"
        if key and _cacheable(request, response):
            headers = [(name, value) for name, value in response.items() if name.lower() != "set-cookie"]
            cache.set(key, (response.status_code, response.content, headers), ttl)
            response["X-Cache"] = "MISS"
        return response

    return wrapper
