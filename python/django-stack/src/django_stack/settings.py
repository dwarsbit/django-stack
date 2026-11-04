"""
Settings from environment variables.

Call ``configure`` near the top of a project's settings module. It sets
the settings that depend on the environment (secrets, the database, the
cache, hosts, mail, storage) and the defaults DjangoStack uses for Django
Headless and Django Content Studio. Settings assigned after the call
override it; ``HEADLESS``, ``CONTENT_STUDIO``, ``REST_FRAMEWORK`` and
``DJANGO_STACK`` dictionaries assigned *before* the call are merged over
the defaults::

    # config/settings.py
    from pathlib import Path

    import django_stack.settings

    BASE_DIR = Path(__file__).resolve().parent.parent
    django_stack.settings.configure(globals(), base_dir=BASE_DIR)

The variables, all optional unless noted:

``DJANGO_SECRET_KEY`` (required), ``DJANGO_DEBUG``, ``SITE_URL`` (the public
URL of the frontend), ``BACKEND_URL`` (the public URL of Django; defaults
to ``SITE_URL``), ``ALLOWED_HOSTS`` (extra hosts, comma separated),
``DATABASE_URL``, ``CACHE_URL``, ``EMAIL_URL``, ``DEFAULT_FROM_EMAIL``,
``MEDIA_URL``, ``S3_BUCKET`` and the other ``S3_*`` variables,
``API_SECRET_KEY`` (full access), ``API_READ_KEY`` (read-only),
``PREVIEW_SECRET``, ``REVALIDATE_URL``, ``REVALIDATE_SECRET``,
``NUM_PROXIES`` and ``PROJECT_NAME``.
"""

from __future__ import annotations

import importlib.util
import os
from collections.abc import Mapping, MutableMapping
from pathlib import Path
from typing import Any

from .env import Env, hostname, mail_settings, origin, parse_cache_url, parse_database_url, parse_email_url

DEFAULT_IMAGE_SIZES = {
    "thumbnail": {"width": 400, "height": 400, "fit": "cover"},
    "card": {"width": 800, "height": 500, "fit": "cover"},
    "content": {"width": 1200},
    "hero": {"width": 2000},
    "share": {"width": 1200, "height": 630, "fit": "cover", "format": "jpeg"},
}

# File types editors may upload. SVG and HTML are left out on purpose: served
# from the site's domain, they could run scripts.
DEFAULT_ALLOWED_EXTENSIONS = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "webp",
    "avif",
    "mp4",
    "webm",
    "mp3",
    "wav",
    "ogg",
    "pdf",
    "txt",
    "csv",
    "docx",
    "xlsx",
    "pptx",
    "odt",
    "ods",
    "zip",
]


def _installed(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def _merge(defaults: dict, overrides: Any) -> dict:
    merged = dict(defaults)
    if isinstance(overrides, Mapping):
        merged.update(overrides)
    return merged


def configure(
    namespace: MutableMapping[str, Any],
    *,
    base_dir: Path | str,
    env: Mapping[str, str] | None = None,
) -> MutableMapping[str, Any]:
    """Set the environment-driven settings in ``namespace`` (a settings module's ``globals()``)."""
    e = Env(os.environ if env is None else env)
    base_dir = Path(base_dir)
    s: dict[str, Any] = {}

    debug = e.bool("DJANGO_DEBUG", False)
    project_name = e.str("PROJECT_NAME", "django-stack")
    site_url = (e.str("SITE_URL", "http://localhost:3000") or "").rstrip("/")
    backend_url = (e.str("BACKEND_URL", site_url) or "").rstrip("/")
    secure = site_url.startswith("https://")

    s["DEBUG"] = debug
    s["SECRET_KEY"] = e.str("DJANGO_SECRET_KEY", required=True)
    s["SITE_URL"] = site_url
    s["BACKEND_URL"] = backend_url

    # Hosts: the public hosts, the backend's name on the Compose network (the
    # frontend reaches Django at http://backend:8000) and localhost for health checks.
    hosts = [hostname(site_url), hostname(backend_url), "backend", "localhost", "127.0.0.1"]
    hosts += e.list("ALLOWED_HOSTS")
    s["ALLOWED_HOSTS"] = list(dict.fromkeys(h for h in hosts if h))
    s["CSRF_TRUSTED_ORIGINS"] = list(dict.fromkeys([origin(site_url), origin(backend_url)]))

    # Database
    database_url = e.str("DATABASE_URL", f"sqlite:///{base_dir / 'db.sqlite3'}")
    s["DATABASES"] = {"default": parse_database_url(database_url)}
    s["DEFAULT_AUTO_FIELD"] = "django.db.models.BigAutoField"

    # Cache: shared by Content Studio (login throttles, sessions, presence),
    # the task queue and the content API.
    cache_url = e.str("CACHE_URL")
    if cache_url:
        s["CACHES"] = {"default": parse_cache_url(cache_url, key_prefix=project_name)}
    else:
        s["CACHES"] = {"default": parse_cache_url("locmem://", key_prefix=project_name)}

    # Tasks: Huey on the shared Redis-compatible cache, run by the worker
    # service. Without a cache, tasks run in the request.
    redis_cache = bool(cache_url) and cache_url.split(":", 1)[0] in ("redis", "rediss", "valkey", "valkeys")
    if redis_cache and _installed("huey"):
        s["HUEY"] = {
            "huey_class": "huey.RedisHuey",
            "name": project_name,
            "immediate": False,
            "connection": {"url": cache_url.replace("valkey", "redis", 1)},
            "consumer": {"workers": e.int("HUEY_WORKERS", 2), "worker_type": "thread"},
        }
        s["TASKS"] = {"default": {"BACKEND": "huey.contrib.djhuey.tasks_backend.HueyBackend"}}
    else:
        s["HUEY"] = {"huey_class": "huey.MemoryHuey", "name": project_name, "immediate": True}
        s["TASKS"] = {"default": {"BACKEND": "django.tasks.backends.immediate.ImmediateBackend"}}

    # Mail
    s.update(mail_settings(parse_email_url(e.str("EMAIL_URL", "console://"))))
    s["DEFAULT_FROM_EMAIL"] = e.str(
        "DEFAULT_FROM_EMAIL", f"{project_name} <noreply@{hostname(site_url) or 'localhost'}>"
    )
    s["SERVER_EMAIL"] = s["DEFAULT_FROM_EMAIL"]

    # Static files and media
    s["STATIC_URL"] = "/static/"
    s["STATIC_ROOT"] = base_dir / "staticfiles"
    s["MEDIA_URL"] = e.str("MEDIA_URL", f"{backend_url}/media/")
    s["MEDIA_ROOT"] = Path(e.str("MEDIA_ROOT", str(base_dir / "media")))

    staticfiles_backend = (
        "whitenoise.storage.CompressedManifestStaticFilesStorage"
        if _installed("whitenoise") and not debug
        else "django.contrib.staticfiles.storage.StaticFilesStorage"
    )
    default_storage: dict[str, Any] = {"BACKEND": "django.core.files.storage.FileSystemStorage"}
    s3_bucket = e.str("S3_BUCKET")
    if s3_bucket:
        options: dict[str, Any] = {
            "bucket_name": s3_bucket,
            "access_key": e.str("S3_ACCESS_KEY_ID"),
            "secret_key": e.str("S3_SECRET_ACCESS_KEY"),
            "region_name": e.str("S3_REGION"),
            "endpoint_url": e.str("S3_ENDPOINT_URL"),
            "default_acl": None,
            "querystring_auth": e.bool("S3_QUERYSTRING_AUTH", False),
            "file_overwrite": False,
        }
        custom_domain = e.str("S3_CUSTOM_DOMAIN")
        if custom_domain:
            options["custom_domain"] = custom_domain
        default_storage = {
            "BACKEND": "storages.backends.s3.S3Storage",
            "OPTIONS": {key: value for key, value in options.items() if value is not None},
        }
        if custom_domain:
            s["MEDIA_URL"] = f"https://{custom_domain}/"
    s["STORAGES"] = {"default": default_storage, "staticfiles": {"BACKEND": staticfiles_backend}}

    # Proxies and HTTPS. TLS ends at the reverse proxy, which sets X-Forwarded-Proto.
    num_proxies = e.int("NUM_PROXIES", 0)
    if num_proxies:
        s["SECURE_PROXY_SSL_HEADER"] = ("HTTP_X_FORWARDED_PROTO", "https")
    s["SESSION_COOKIE_SECURE"] = secure
    s["CSRF_COOKIE_SECURE"] = secure
    s["SESSION_COOKIE_HTTPONLY"] = True
    s["SESSION_COOKIE_SAMESITE"] = "Lax"
    s["SECURE_CONTENT_TYPE_NOSNIFF"] = True
    s["SECURE_REFERRER_POLICY"] = "strict-origin-when-cross-origin"
    s["X_FRAME_OPTIONS"] = "DENY"
    if secure:
        s["SECURE_HSTS_SECONDS"] = e.int("SECURE_HSTS_SECONDS", 31536000)
        s["SECURE_HSTS_INCLUDE_SUBDOMAINS"] = e.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
        # The reverse proxy redirects HTTP to HTTPS; redirecting in Django as
        # well would break the health checks on the internal network.
        s["SECURE_SSL_REDIRECT"] = e.bool("SECURE_SSL_REDIRECT", False)

    # Django REST Framework, for the generated routes and DjangoStack's own views.
    s["REST_FRAMEWORK"] = _merge(
        {
            "DEFAULT_AUTHENTICATION_CLASSES": ["headless.rest.authentication.SecretKeyAuthentication"],
            "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAdminUser"],
            "DEFAULT_THROTTLE_CLASSES": ["django_stack.rest.throttling.PublicWriteThrottle"],
            "DEFAULT_THROTTLE_RATES": {"public_write": e.str("PUBLIC_WRITE_THROTTLE_RATE", "10/minute")},
            "NUM_PROXIES": num_proxies or None,
        },
        namespace.get("REST_FRAMEWORK"),
    )

    # Django Headless: routes closed by default, the read-only key for the
    # frontend, drafts only with a preview token.
    s["HEADLESS"] = _merge(
        {
            "AUTH_SECRET_KEY": e.str("API_SECRET_KEY"),
            "AUTH_READ_ONLY_SECRET_KEY": e.str("API_READ_KEY"),
            # Keys only: no session authentication, so a logged-in editor's
            # cookie never authorizes API requests from other sites.
            "DEFAULT_AUTHENTICATION_CLASSES": ["headless.rest.authentication.SecretKeyAuthentication"],
            "DEFAULT_PERMISSION_CLASSES": ["django_stack.rest.permissions.StackPermission"],
            "DEFAULT_FILTER_BACKENDS": [
                "django_stack.rest.filters.PublishedFilter",
                "headless.rest.filters.LookupFilter",
                "rest_framework.filters.SearchFilter",
                "rest_framework.filters.OrderingFilter",
            ],
            "DEFAULT_PAGINATION_CLASS": "headless.rest.pagination.PageNumberPagination",
            "PAGE_SIZE": 20,
            "MAX_PAGE_SIZE": 100,
            "DEFAULT_SERIALIZER_CLASS": "django_stack.rest.serializers.StackSerializer",
            "SCHEMA": True,
            "SCHEMA_TITLE": f"{project_name} API",
            "VERSION_CHECK": debug,
        },
        namespace.get("HEADLESS"),
    )

    # Django Content Studio
    s["CONTENT_STUDIO"] = _merge(
        {
            "ADMIN_SITE": "config.studio.admin_site",
            "MEDIA_LIBRARY_MODEL": "content_studio.media_library.models.Media",
            "MEDIA_LIBRARY_FOLDER_MODEL": "content_studio.media_library.models.Folder",
            "MEDIA_LIBRARY_ALLOWED_EXTENSIONS": DEFAULT_ALLOWED_EXTENSIONS,
            "MEDIA_LIBRARY_MAX_UPLOAD_SIZE": e.int("MEDIA_MAX_UPLOAD_SIZE", 50 * 1024 * 1024),
            "IMAGE_SIZES": DEFAULT_IMAGE_SIZES,
            "ADMIN_URL": f"{backend_url}/admin/",
        },
        namespace.get("CONTENT_STUDIO"),
    )

    # DjangoStack itself
    s["DJANGO_STACK"] = _merge(
        {
            "PREVIEW_SECRET": e.str("PREVIEW_SECRET"),
            "PREVIEW_MAX_AGE": e.int("PREVIEW_MAX_AGE", 3600),
            "REVALIDATE_URL": e.str("REVALIDATE_URL"),
            "REVALIDATE_SECRET": e.str("REVALIDATE_SECRET"),
            "PUBLIC_CREATE": [],
            "CONTENT_APPS": ["content"],
            "SEED_CONTENT": None,
            "ADMIN_USERNAME": e.str("ADMIN_USERNAME", "admin"),
            "ADMIN_EMAIL": e.str("ADMIN_EMAIL"),
            "ADMIN_PASSWORD": e.str("ADMIN_PASSWORD"),
        },
        namespace.get("DJANGO_STACK"),
    )

    s["LOGGING"] = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"plain": {"format": "{levelname} {name} {message}", "style": "{"}},
        "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
        "root": {"handlers": ["console"], "level": e.str("LOG_LEVEL", "INFO")},
        "loggers": {"django": {"handlers": ["console"], "level": "INFO", "propagate": False}},
    }

    namespace.update(s)
    return namespace
