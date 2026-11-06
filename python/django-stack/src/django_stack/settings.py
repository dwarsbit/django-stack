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
``NUM_PROXIES``, ``PROJECT_NAME``, and the backup variables ``BACKUP_DIR``,
``BACKUP_KEEP``, ``BACKUP_TIME``, ``BACKUP_MEDIA``, ``BACKUP_S3_BUCKET`` and
``BACKUP_S3_PREFIX`` and ``BACKUP_PING_URL``, and the analytics variables ``UMAMI_URL`` (the
internal address of the bundled Umami), ``UMAMI_WEBSITE_ID`` and
``UMAMI_ADMIN_PASSWORD``, and the log variables ``LOG_FORMAT`` (``json``
or ``plain``), ``LOG_LEVEL`` and ``LOG_ACCESS``.
"""

from __future__ import annotations

import importlib.util
import os
from collections.abc import Mapping, MutableMapping
from pathlib import Path
from typing import Any

from django.core.exceptions import ImproperlyConfigured

from .env import Env, hostname, mail_settings, origin, parse_cache_url, parse_database_url, parse_email_url
from .logs import logging_settings

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


REDIS_SCHEMES = ("redis", "rediss", "valkey", "valkeys")


def _scheme(url: str | None) -> str:
    return (url or "").split(":", 1)[0].lower()


def task_settings(
    tasks_url: str | None, cache_url: str | None, database_url: str, project_name: str, e: Env
) -> dict[str, Any]:
    """HUEY and TASKS for a TASKS_URL (or, without one, the cache's Redis)."""
    scheme = _scheme(tasks_url)
    if not scheme:
        scheme, tasks_url = ("redis", cache_url) if _scheme(cache_url) in REDIS_SCHEMES else ("immediate", "")
    immediate = {
        "HUEY": {"huey_class": "huey.MemoryHuey", "name": project_name, "immediate": True},
        "TASKS": {"default": {"BACKEND": "django.tasks.backends.immediate.ImmediateBackend"}},
    }
    if scheme == "immediate" or not _installed("huey"):
        return immediate
    consumer = {"workers": e.int("HUEY_WORKERS", 2), "worker_type": "thread"}
    if scheme in REDIS_SCHEMES:
        huey: dict[str, Any] = {
            "huey_class": "huey.RedisHuey",
            "connection": {"url": str(tasks_url).replace("valkey", "redis", 1)},
        }
    elif scheme == "db":
        database_scheme = _scheme(database_url)
        if database_scheme in ("postgres", "postgresql"):
            database = "psycopg3:" + database_url.split(":", 1)[1]
        elif database_scheme == "sqlite":
            database = "sqlite:///" + parse_database_url(database_url)["NAME"]
        else:
            raise ImproperlyConfigured("TASKS_URL=db:// needs a postgres:// or sqlite:// DATABASE_URL.")
        # Polls the database; `migrate` creates the huey_* tables.
        huey = {
            "huey_class": "django_stack.huey.SqlHuey",
            "database": database,
            "create_tables": False,
        }
    else:
        raise ImproperlyConfigured(
            f"TASKS_URL has an unsupported scheme {scheme!r}; use db://, redis:// or immediate://."
        )
    return {
        "HUEY": {"name": project_name, "immediate": False, **huey, "consumer": consumer},
        "TASKS": {"default": {"BACKEND": "huey.contrib.djhuey.tasks_backend.HueyBackend"}},
    }


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
    s["PROJECT_NAME"] = project_name
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

    # Cache: shared by Content Studio (login throttles, sessions, presence)
    # and the content API. db:// is a table in the database, redis:// the
    # Valkey service.
    cache_url = e.str("CACHE_URL")
    if cache_url:
        s["CACHES"] = {"default": parse_cache_url(cache_url, key_prefix=project_name)}
    else:
        s["CACHES"] = {"default": parse_cache_url("locmem://", key_prefix=project_name)}

    # Tasks: Huey, run by the worker service. TASKS_URL picks its queue:
    # db:// (tables in the database), redis:// (the Valkey service) or
    # immediate:// (no worker: tasks run in the request). Without TASKS_URL
    # the queue follows a Redis-compatible CACHE_URL, as before 0.7.
    s.update(task_settings(e.str("TASKS_URL"), cache_url, database_url, project_name, e))
    # Task statistics for the admin's task page: in Postgres, so the web and
    # worker containers share them (the default is a SQLite file per container).
    if database_url.split(":", 1)[0] in ("postgres", "postgresql") and "HUEY_STATS" not in namespace:
        s["HUEY_STATS"] = {"database": "psycopg3:" + database_url.split(":", 1)[1]}

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
        "django_stack.staticfiles.StaticFilesStorage"
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
        # The public base URL of the files, when it is not the endpoint: a CDN,
        # or http://localhost:8333/media for the development S3 service.
        public_url = (e.str("S3_PUBLIC_URL") or "").rstrip("/")
        custom_domain = e.str("S3_CUSTOM_DOMAIN")
        if public_url:
            scheme, _, rest = public_url.partition("://")
            options["custom_domain"] = rest
            options["url_protocol"] = f"{scheme}:"
            s["MEDIA_URL"] = f"{public_url}/"
        elif custom_domain:
            options["custom_domain"] = custom_domain
        default_storage = {
            "BACKEND": "storages.backends.s3.S3Storage",
            "OPTIONS": {key: value for key, value in options.items() if value is not None},
        }
        if custom_domain and not public_url:
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
        s["SECURE_HSTS_PRELOAD"] = e.bool("SECURE_HSTS_PRELOAD", False)

    # Deploy checks that do not apply: the proxy redirects to HTTPS, and HSTS
    # for subdomains or the preload list is a choice for the whole domain,
    # which SECURE_HSTS_INCLUDE_SUBDOMAINS and SECURE_HSTS_PRELOAD opt into.
    silenced = list(namespace.get("SILENCED_SYSTEM_CHECKS", []))
    if secure:
        silenced += ["security.W005", "security.W021"]
        if num_proxies and not s["SECURE_SSL_REDIRECT"]:
            silenced.append("security.W008")
    s["SILENCED_SYSTEM_CHECKS"] = list(dict.fromkeys(silenced))

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
            # With content_studio.notifications installed: mail editors what
            # they left unread (the worker's notification_digest task).
            "NOTIFICATION_EMAIL_DIGEST": True,
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
            "BACKUP_DIR": e.str("BACKUP_DIR", str(base_dir / "backups")),
            "BACKUP_KEEP": e.int("BACKUP_KEEP", 14),
            "BACKUP_TIME": e.str("BACKUP_TIME", "03:00"),
            # A private bucket: never the public media bucket.
            "BACKUP_S3_BUCKET": e.str("BACKUP_S3_BUCKET"),
            "BACKUP_S3_PREFIX": e.str("BACKUP_S3_PREFIX", "backups/"),
            "BACKUP_MEDIA": e.bool("BACKUP_MEDIA", True),
            "BACKUP_DAILY": e.bool("BACKUP_DAILY", False),
            # Pinged after each daily backup, for a dead man's switch
            # such as Healthchecks.io or Uptime Kuma's push monitor.
            "BACKUP_PING_URL": e.str("BACKUP_PING_URL"),
            "BACKUP_S3": {
                "endpoint_url": e.str("BACKUP_S3_ENDPOINT_URL", e.str("S3_ENDPOINT_URL")),
                "region_name": e.str("BACKUP_S3_REGION", e.str("S3_REGION")),
                "access_key": e.str("BACKUP_S3_ACCESS_KEY_ID", e.str("S3_ACCESS_KEY_ID")),
                "secret_key": e.str("BACKUP_S3_SECRET_ACCESS_KEY", e.str("S3_SECRET_ACCESS_KEY")),
            },
            # Page analytics from the bundled Umami; off without UMAMI_URL.
            "UMAMI_URL": e.str("UMAMI_URL"),
            "UMAMI_WEBSITE_ID": e.str("UMAMI_WEBSITE_ID"),
            "UMAMI_USERNAME": "admin",
            "UMAMI_PASSWORD": e.str("UMAMI_ADMIN_PASSWORD"),
        },
        namespace.get("DJANGO_STACK"),
    )

    # Logs: JSON lines in production, plain text in development; see logs.py.
    log_format = e.str("LOG_FORMAT", "plain" if debug else "json")
    if log_format not in ("json", "plain"):
        raise ImproperlyConfigured(f"LOG_FORMAT must be json or plain, not {log_format!r}.")
    s["LOGGING"] = logging_settings(
        log_format, e.str("LOG_LEVEL", "INFO"), access=e.bool("LOG_ACCESS", not debug)
    )

    namespace.update(s)
    return namespace
