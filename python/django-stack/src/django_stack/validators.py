"""
Links editors type, such as the URL of a menu item or a button: a path on
the site, a fragment, or an http(s), mailto or tel URL. Any other scheme,
such as ``javascript:``, could run script on the site.

    from django_stack.validators import validate_link

    url = models.CharField(max_length=500, validators=[validate_link])
"""

from __future__ import annotations

import re

from django.core.exceptions import ValidationError

SAFE_SCHEMES = ("http", "https", "mailto", "tel")
_SCHEME = re.compile(r"^([a-z][a-z0-9+.-]*):", re.IGNORECASE)
# What browsers strip before they read the scheme.
_LEADING = re.compile(r"^[\x00-\x20]+")
_INSIDE = re.compile(r"[\t\n\r]")


def link_scheme(url: str) -> str | None:
    """The scheme of ``url`` as a browser reads it, lower case, or None for a relative URL."""
    match = _SCHEME.match(_INSIDE.sub("", _LEADING.sub("", url)))
    return match[1].lower() if match else None


def is_safe_link(url: str | None) -> bool:
    if not url:
        return True
    scheme = link_scheme(str(url))
    return scheme is None or scheme in SAFE_SCHEMES


def safe_href(url: str | None, fallback: str = "/") -> str:
    """``url`` when it is a safe link, otherwise ``fallback``: safeHref of @django-stack/utils."""
    value = (url or "").strip()
    if not value:
        return fallback
    return value if is_safe_link(value) else fallback


def validate_link(value: str) -> None:
    if not is_safe_link(value):
        raise ValidationError(
            "Enter a path such as /contact, or a URL that starts with https://, http://, mailto: or tel:.",
            code="invalid_link",
        )
