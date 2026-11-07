"""
Umami's tracker and page views at /_a/, for a site Django renders where no
reverse proxy serves them, such as in development. In production Caddy
proxies /_a/ before the request reaches Django. Only the tracker and the
page views pass, never Umami's interface or API.
"""

from __future__ import annotations

import logging
import urllib.error
import urllib.request

from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST, require_safe

from ... import conf

logger = logging.getLogger("django_stack.analytics")


def _forward(request, path: str, data: bytes | None = None) -> HttpResponse:
    base = (conf.get("UMAMI_URL") or "").rstrip("/")
    if not base:
        return HttpResponse(status=404)
    headers = {"User-Agent": request.headers.get("User-Agent", "")}
    if data is not None:
        headers["Content-Type"] = request.headers.get("Content-Type", "application/json")
    # The visitor's address, for Umami's location and unique-visitor counts.
    client = request.headers.get("X-Forwarded-For") or request.META.get("REMOTE_ADDR")
    if client:
        headers["X-Forwarded-For"] = client
    upstream = urllib.request.Request(f"{base}{path}", data=data, headers=headers)  # noqa: S310
    try:
        with urllib.request.urlopen(upstream, timeout=5) as answer:  # noqa: S310 - the project's own Umami
            body, status, content_type = answer.read(), answer.status, answer.headers.get("Content-Type")
    except urllib.error.HTTPError as error:
        body, status, content_type = error.read(), error.code, error.headers.get("Content-Type")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        logger.warning("Umami at %s did not answer: %s", base, error)
        return HttpResponse(status=502)
    return HttpResponse(body, status=status, content_type=content_type or "application/octet-stream")


@require_safe
def tracker(request):
    response = _forward(request, "/script.js")
    if response.status_code == 200:
        response["Cache-Control"] = "public, max-age=3600"
    return response


@csrf_exempt
@require_POST
def send(request):
    return _forward(request, "/api/send", request.body)
