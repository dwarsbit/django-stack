"""Small, dependency-free readers for environment variables."""

from __future__ import annotations

from collections.abc import Mapping
from urllib.parse import parse_qsl, unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

TRUE_VALUES = {"1", "true", "yes", "on"}
FALSE_VALUES = {"0", "false", "no", "off", ""}


class Env:
    """Typed access to a mapping of environment variables."""

    def __init__(self, environ: Mapping[str, str]):
        self.environ = environ

    def str(self, name: str, default: str | None = None, *, required: bool = False) -> str | None:
        value = self.environ.get(name)
        if value is None or value == "":
            if required:
                raise ImproperlyConfigured(f"Set the {name} environment variable.")
            return default
        return value

    def bool(self, name: str, default: bool = False) -> bool:
        value = self.environ.get(name)
        if value is None:
            return default
        normalized = value.strip().lower()
        if normalized in TRUE_VALUES:
            return True
        if normalized in FALSE_VALUES:
            return False
        raise ImproperlyConfigured(f"{name} must be a boolean (1 or 0), not {value!r}.")

    def int(self, name: str, default: int | None = None) -> int | None:
        value = self.environ.get(name)
        if value is None or value == "":
            return default
        try:
            return int(value)
        except ValueError as error:
            raise ImproperlyConfigured(f"{name} must be a whole number, not {value!r}.") from error

    def list(self, name: str, default: list[str] | None = None) -> list[str]:
        value = self.environ.get(name)
        if value is None or value.strip() == "":
            return list(default or [])
        return [item.strip() for item in value.split(",") if item.strip()]


def parse_database_url(url: str) -> dict:
    """
    Django's DATABASES entry for a URL such as
    postgres://user:password@host:5432/name?sslmode=require or sqlite:///path.
    """
    parts = urlsplit(url)
    scheme = parts.scheme.lower()

    if scheme == "sqlite":
        # sqlite:///relative.db, sqlite:////absolute/path.db, sqlite://:memory:
        name = parts.path[1:] if parts.path.startswith("/") else parts.path
        if parts.netloc == ":memory:" or name == ":memory:":
            name = ":memory:"
        return {"ENGINE": "django.db.backends.sqlite3", "NAME": unquote(name)}

    if scheme in ("postgres", "postgresql", "pgsql", "postgis"):
        engine = (
            "django.contrib.gis.db.backends.postgis"
            if scheme == "postgis"
            else "django.db.backends.postgresql"
        )
        options = dict(parse_qsl(parts.query))
        config = {
            "ENGINE": engine,
            "NAME": unquote(parts.path.lstrip("/")),
            "USER": unquote(parts.username or ""),
            "PASSWORD": unquote(parts.password or ""),
            "HOST": unquote(parts.hostname or ""),
            "PORT": str(parts.port or ""),
            # No persistent connections: under ASGI every request runs in a
            # new thread, so a kept connection is never reused and they pile
            # up until Postgres refuses more. DATABASE_POOL reuses them.
            "CONN_MAX_AGE": 0,
            "CONN_HEALTH_CHECKS": True,
        }
        if options:
            config["OPTIONS"] = options
        return config

    raise ImproperlyConfigured(
        f"DATABASE_URL has an unsupported scheme {scheme!r}; use postgres:// or sqlite://."
    )


def parse_cache_url(url: str, *, key_prefix: str = "") -> dict:
    """Django's CACHES entry for redis://, rediss://, db://, locmem:// or dummy://."""
    scheme = urlsplit(url).scheme.lower()

    if scheme in ("redis", "rediss", "valkey", "valkeys"):
        location = url.replace("valkey", "redis", 1) if scheme.startswith("valkey") else url
        return {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": location,
            "KEY_PREFIX": key_prefix,
        }
    if scheme == "db":
        # A table in the project's database; `migrate` creates it.
        return {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "django_cache",
            "KEY_PREFIX": key_prefix,
        }
    if scheme == "locmem":
        return {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": key_prefix or "default",
        }
    if scheme == "dummy":
        return {"BACKEND": "django.core.cache.backends.dummy.DummyCache"}

    raise ImproperlyConfigured(
        f"CACHE_URL has an unsupported scheme {scheme!r}; use redis://, db://, locmem:// or dummy://."
    )


def parse_email_url(url: str) -> dict:
    """
    The mailer for smtp://, smtp+tls://, smtps://, console:// or locmem://,
    in the shape of Django's MAILERS entries: {"BACKEND": ..., "OPTIONS": {...}}.
    """
    parts = urlsplit(url)
    scheme = parts.scheme.lower()

    if scheme == "console":
        return {"BACKEND": "django.core.mail.backends.console.EmailBackend", "OPTIONS": {}}
    if scheme == "locmem":
        return {"BACKEND": "django.core.mail.backends.locmem.EmailBackend", "OPTIONS": {}}
    if scheme in ("smtp", "smtp+tls", "smtps"):
        return {
            "BACKEND": "django.core.mail.backends.smtp.EmailBackend",
            "OPTIONS": {
                "host": parts.hostname or "localhost",
                "port": parts.port or (465 if scheme == "smtps" else 587 if scheme == "smtp+tls" else 25),
                "username": unquote(parts.username or ""),
                "password": unquote(parts.password or ""),
                "use_tls": scheme == "smtp+tls",
                "use_ssl": scheme == "smtps",
            },
        }

    raise ImproperlyConfigured(
        f"EMAIL_URL has an unsupported scheme {scheme!r}; use smtp://, smtps:// or console://."
    )


def mail_settings(mailer: dict) -> dict:
    """
    The settings for a mailer: MAILERS on Django 6.1 and later, the
    EMAIL_* settings before.
    """
    import django

    if django.VERSION >= (6, 1):
        return {"MAILERS": {"default": mailer}}

    options = mailer["OPTIONS"]
    legacy = {"EMAIL_BACKEND": mailer["BACKEND"]}
    names = {"host": "EMAIL_HOST", "port": "EMAIL_PORT", "username": "EMAIL_HOST_USER"}
    names |= {"password": "EMAIL_HOST_PASSWORD", "use_tls": "EMAIL_USE_TLS", "use_ssl": "EMAIL_USE_SSL"}
    for option, setting in names.items():
        if option in options:
            legacy[setting] = options[option]
    return legacy


def origin(url: str) -> str:
    """The origin (scheme://host[:port]) of a URL."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def hostname(url: str) -> str:
    return urlsplit(url).hostname or ""
