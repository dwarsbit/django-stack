"""
DjangoStack's system checks.

- ``django_stack.E001``: the read-only API key is the full-access key.
- ``django_stack.E002``: no read-only API key, so the frontend cannot read content.
- ``django_stack.E003``: ``DEBUG`` is on while ``SITE_URL`` is https.
- ``django_stack.E004``: a model in ``PUBLIC_CREATE`` is not installed.
- ``django_stack.W001``: ``REVALIDATE_URL`` without ``REVALIDATE_SECRET``, so the
  frontend is never told about changes.
- ``django_stack.W002``: no ``PREVIEW_SECRET``, so editors cannot preview drafts.
- ``django_stack.W003`` (deploy): ``SECRET_KEY`` shorter than 50 characters.
- ``django_stack.W004`` (deploy): the cache is per process, so throttles,
  sessions and presence are not shared between workers.
- ``django_stack.W005`` (deploy): ``SITE_URL`` is https but ``NUM_PROXIES`` is 0,
  so Django does not see that requests came in over HTTPS.
- ``django_stack.W006``: ``UMAMI_URL`` is set without ``UMAMI_ADMIN_PASSWORD`` or
  ``UMAMI_WEBSITE_ID``; Content Studio reports it with its analytics checks.
"""

from django.apps import apps
from django.conf import settings
from django.core.checks import Error, Tags, Warning, register

from . import conf


def _headless():
    return getattr(settings, "HEADLESS", None) or {}


@register(Tags.security)
def check_api_keys(app_configs, **kwargs):
    errors = []
    write_key = _headless().get("AUTH_SECRET_KEY")
    read_key = _headless().get("AUTH_READ_ONLY_SECRET_KEY")
    if write_key and read_key and write_key == read_key:
        errors.append(
            Error(
                "API_READ_KEY is the same as API_SECRET_KEY.",
                hint="Generate a separate read-only key: the frontend must not hold a key that can write.",
                id="django_stack.E001",
            )
        )
    if not read_key:
        errors.append(
            Error(
                "API_READ_KEY is not set.",
                hint="Set API_READ_KEY: the frontend reads content with it.",
                id="django_stack.E002",
            )
        )
    return errors


@register(Tags.security)
def check_debug(app_configs, **kwargs):
    site_url = getattr(settings, "SITE_URL", "") or ""
    if settings.DEBUG and site_url.startswith("https://"):
        return [
            Error(
                "DEBUG is on while SITE_URL is https.",
                hint="Set DJANGO_DEBUG=0 in production: debug pages show settings and source code.",
                id="django_stack.E003",
            )
        ]
    return []


@register()
def check_public_create(app_configs, **kwargs):
    errors = []
    for label in conf.get("PUBLIC_CREATE"):
        try:
            apps.get_model(label)
        except (LookupError, ValueError):
            errors.append(
                Error(
                    f"PUBLIC_CREATE names {label!r}, which is not an installed model.",
                    hint="Use the model's label, such as 'content.formsubmission'.",
                    id="django_stack.E004",
                )
            )
    return errors


@register()
def check_secrets(app_configs, **kwargs):
    warnings = []
    if conf.get("REVALIDATE_URL") and not conf.get("REVALIDATE_SECRET"):
        warnings.append(
            Warning(
                "REVALIDATE_URL is set without REVALIDATE_SECRET.",
                hint="Set REVALIDATE_SECRET to the same value as in the frontend.",
                id="django_stack.W001",
            )
        )
    if not conf.get("PREVIEW_SECRET"):
        warnings.append(
            Warning(
                "PREVIEW_SECRET is not set, so editors cannot preview drafts.",
                hint="Set PREVIEW_SECRET to the same value as in the frontend.",
                id="django_stack.W002",
            )
        )
    return warnings


@register(Tags.security, deploy=True)
def check_deploy(app_configs, **kwargs):
    warnings = []
    if len(settings.SECRET_KEY or "") < 50:
        warnings.append(
            Warning(
                "DJANGO_SECRET_KEY is shorter than 50 characters.",
                hint="Generate a new one, for example with `npx @django-stack/cli secret`.",
                id="django_stack.W003",
            )
        )
    backend = settings.CACHES.get("default", {}).get("BACKEND", "")
    if backend.endswith(("LocMemCache", "DummyCache")):
        warnings.append(
            Warning(
                "The default cache is not shared between processes.",
                hint="Set CACHE_URL to the Valkey or Redis service.",
                id="django_stack.W004",
            )
        )
    site_url = getattr(settings, "SITE_URL", "") or ""
    if site_url.startswith("https://") and not getattr(settings, "SECURE_PROXY_SSL_HEADER", None):
        warnings.append(
            Warning(
                "SITE_URL is https, but Django does not trust the proxy's X-Forwarded-Proto header.",
                hint="Set NUM_PROXIES=1 behind Caddy, so secure cookies and CSRF checks see HTTPS.",
                id="django_stack.W005",
            )
        )
    return warnings
