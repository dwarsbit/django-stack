"""Preview for a site Django renders: the admin's Preview link sets a cookie with the token."""

from __future__ import annotations

from ... import conf
from ...preview import published as published_queryset
from ...signing import verify_preview_token

PREVIEW_COOKIE = "django_stack_preview"


def in_preview(request) -> bool:
    """Whether the request carries a valid preview token in the preview cookie."""
    token = request.COOKIES.get(PREVIEW_COOKIE) if request is not None else None
    return verify_preview_token(conf.get("PREVIEW_SECRET"), token)


def published(queryset, request=None):
    """The objects of ``queryset`` the visitor may see: published ones, or drafts too in preview."""
    return published_queryset(queryset, drafts=in_preview(request))
