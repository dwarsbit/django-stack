from __future__ import annotations

from datetime import UTC, datetime

from django.http import HttpResponse, HttpResponseRedirect
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe

from ... import conf
from ...signing import verify_preview_token
from .preview import PREVIEW_COOKIE


def local_path(path: str | None) -> str:
    """``path`` when it is a path on this site, otherwise ``/``: never another origin."""
    if not path or not path.startswith("/") or path.startswith(("//", "/\\")):
        return "/"
    return path


@never_cache
@require_safe
def preview(request):
    """
    Opens a page with drafts shown. The admin's Preview button links here
    with a token signed with PREVIEW_SECRET; the token is kept in a cookie
    until it expires.
    """
    token = request.GET.get("token", "")
    if not verify_preview_token(conf.get("PREVIEW_SECRET"), token):
        message = "The preview link is invalid or has expired."
        return HttpResponse(message, status=401, content_type="text/plain; charset=utf-8")
    response = HttpResponseRedirect(local_path(request.GET.get("path")))
    response.set_cookie(
        PREVIEW_COOKIE,
        token,
        expires=datetime.fromtimestamp(int(token.split(".", 1)[0]), tz=UTC),
        httponly=True,
        samesite="Lax",
        secure=request.is_secure(),
    )
    return response


@never_cache
@require_safe
def preview_exit(request):
    response = HttpResponseRedirect("/")
    response.delete_cookie(PREVIEW_COOKIE, samesite="Lax")
    return response
