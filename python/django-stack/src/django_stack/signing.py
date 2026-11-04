"""
HMAC signatures shared with the frontend packages (@django-stack/utils).

Preview tokens: ``<expires>.<signature>``, where the signature is the hex
HMAC-SHA256 of ``preview.<expires>`` with PREVIEW_SECRET as the key and
``expires`` a Unix timestamp in seconds.

Webhook signatures: the header ``t=<timestamp>,v1=<signature>``, where the
signature is the hex HMAC-SHA256 of ``<timestamp>.<raw body>``, the same
scheme Django Content Studio uses for its webhooks.
"""

from __future__ import annotations

import hashlib
import hmac
import time


def _hmac(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def sign_preview_token(secret: str, max_age: int = 3600, *, now: float | None = None) -> str:
    expires = int((now if now is not None else time.time()) + max_age)
    return f"{expires}.{_hmac(secret, f'preview.{expires}'.encode())}"


def verify_preview_token(secret: str | None, token: str | None, *, now: float | None = None) -> bool:
    if not secret or not token or "." not in token:
        return False
    expires_text, signature = token.split(".", 1)
    if not expires_text.isdigit():
        return False
    expected = _hmac(secret, f"preview.{expires_text}".encode())
    if not hmac.compare_digest(expected.encode(), signature.encode()):
        return False
    return int(expires_text) >= (now if now is not None else time.time())


def sign_webhook(secret: str, body: bytes, *, timestamp: int | None = None) -> str:
    timestamp = int(time.time()) if timestamp is None else timestamp
    return f"t={timestamp},v1={_hmac(secret, f'{timestamp}.'.encode() + body)}"


def verify_webhook(
    secret: str, header: str | None, body: bytes, *, tolerance: int = 300, now: float | None = None
) -> bool:
    if not secret or not header:
        return False
    try:
        fields = dict(part.split("=", 1) for part in header.split(","))
        timestamp = int(fields["t"])
        signature = fields["v1"]
    except (KeyError, ValueError):
        return False
    expected = _hmac(secret, f"{timestamp}.".encode() + body)
    current = now if now is not None else time.time()
    return abs(current - timestamp) <= tolerance and hmac.compare_digest(
        expected.encode(), signature.encode()
    )
