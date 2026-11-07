"""Preview tokens: draft content for editors, through the frontend."""

from __future__ import annotations

from urllib.parse import urlencode

from django.conf import settings

from . import conf
from .signing import sign_preview_token, verify_preview_token


def make_preview_token() -> str:
    secret = conf.get("PREVIEW_SECRET")
    if not secret:
        raise ValueError("Set PREVIEW_SECRET to create preview links.")
    return sign_preview_token(secret, conf.get("PREVIEW_MAX_AGE"))


def has_preview_access(request) -> bool:
    """Whether the request carries a valid preview token in the preview header."""
    header = conf.get("PREVIEW_HEADER")
    token = request.headers.get(header) if hasattr(request, "headers") else None
    return verify_preview_token(conf.get("PREVIEW_SECRET"), token)


def preview_url(path: str) -> str:
    """
    The frontend's preview route that opens ``path`` with drafts shown. It is
    /preview, not under /api/, because /api/ belongs to Django on the site's domain.
    """
    site_url = getattr(settings, "SITE_URL", "").rstrip("/")
    return f"{site_url}/preview?{urlencode({'token': make_preview_token(), 'path': path})}"


def published(queryset, *, drafts: bool = False):
    """
    The objects a visitor may see: the published ones, or all of them with
    ``drafts`` (a preview). Querysets without a ``published()`` method are
    returned as they are. The content API and ``django_stack.contrib.site``
    both use it, so the API and a site rendered by Django show the same.
    """
    if drafts or not hasattr(queryset, "published"):
        return queryset
    return queryset.published()
