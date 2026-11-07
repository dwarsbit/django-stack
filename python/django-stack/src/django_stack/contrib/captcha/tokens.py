import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone

from ... import conf

TOKEN_LIFETIME = timedelta(minutes=20)


def _digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def issue_token() -> tuple[str, int]:
    """A new token for a solved challenge, and when it expires in milliseconds since the epoch."""
    from .models import Token

    token_id, secret = secrets.token_hex(8), secrets.token_hex(15)
    expires_at = timezone.now() + TOKEN_LIFETIME
    Token.objects.create(id=token_id, digest=_digest(secret), expires_at=expires_at)
    return f"{token_id}:{secret}", int(expires_at.timestamp() * 1000)


def verify_captcha(token) -> bool:
    """
    Whether ``token`` is a token the widget redeemed, unused and not
    expired. A token is valid once: verifying it uses it up. With
    ``CAPTCHA=off`` every token is valid.
    """
    if not conf.get("CAPTCHA"):
        return True
    from .models import Token

    if not isinstance(token, str):
        return False
    token_id, _, secret = token.partition(":")
    if not token_id or not secret or len(token) > 100:
        return False
    deleted, _ = Token.objects.filter(
        id=token_id, digest=_digest(secret), expires_at__gt=timezone.now()
    ).delete()
    return deleted > 0
