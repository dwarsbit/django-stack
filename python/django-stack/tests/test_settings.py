from pathlib import Path

import pytest
from django.core.exceptions import ImproperlyConfigured

from django_stack.settings import configure

BASE_ENV = {"DJANGO_SECRET_KEY": "x" * 60}


def run(env, namespace=None):
    return configure(
        namespace if namespace is not None else {}, base_dir=Path("/srv/app"), env={**BASE_ENV, **env}
    )


def test_requires_a_secret_key():
    with pytest.raises(ImproperlyConfigured):
        configure({}, base_dir=Path("/srv"), env={})


def test_development_defaults():
    s = run(
        {"DJANGO_DEBUG": "1", "SITE_URL": "http://localhost:3000", "BACKEND_URL": "http://localhost:8000"}
    )
    assert s["DEBUG"] is True
    assert {"localhost", "backend"} <= set(s["ALLOWED_HOSTS"])
    assert s["CSRF_TRUSTED_ORIGINS"] == ["http://localhost:3000", "http://localhost:8000"]
    assert s["MEDIA_URL"] == "http://localhost:8000/media/"
    assert s["DATABASES"]["default"]["ENGINE"] == "django.db.backends.sqlite3"
    assert s["SESSION_COOKIE_SECURE"] is False
    assert s["TASKS"]["default"]["BACKEND"].endswith("ImmediateBackend")


def test_production_settings():
    s = run(
        {
            "SITE_URL": "https://example.com",
            "DATABASE_URL": "postgres://app:pw@db/app",
            "CACHE_URL": "redis://cache:6379/0",
            "NUM_PROXIES": "1",
            "PROJECT_NAME": "site",
        }
    )
    assert s["DEBUG"] is False
    assert "example.com" in s["ALLOWED_HOSTS"]
    assert s["SESSION_COOKIE_SECURE"] is True
    assert s["SECURE_HSTS_SECONDS"] == 31536000
    assert s["SECURE_PROXY_SSL_HEADER"] == ("HTTP_X_FORWARDED_PROTO", "https")
    assert s["MEDIA_URL"] == "https://example.com/media/"
    assert s["HUEY"]["connection"] == {"url": "redis://cache:6379/0"}
    assert s["TASKS"]["default"]["BACKEND"] == "huey.contrib.djhuey.tasks_backend.HueyBackend"
    assert s["REST_FRAMEWORK"]["NUM_PROXIES"] == 1


def test_s3_storage():
    s = run(
        {
            "S3_BUCKET": "media",
            "S3_ENDPOINT_URL": "https://s3.example.com",
            "S3_CUSTOM_DOMAIN": "cdn.example.com",
        }
    )
    assert s["STORAGES"]["default"]["BACKEND"] == "storages.backends.s3.S3Storage"
    assert s["STORAGES"]["default"]["OPTIONS"]["bucket_name"] == "media"
    assert s["MEDIA_URL"] == "https://cdn.example.com/"


def test_dictionaries_are_merged_over_the_defaults():
    s = run(
        {"API_READ_KEY": "r"}, {"HEADLESS": {"PAGE_SIZE": 50}, "DJANGO_STACK": {"CONTENT_APPS": ["blog"]}}
    )
    assert s["HEADLESS"]["PAGE_SIZE"] == 50
    assert s["HEADLESS"]["AUTH_READ_ONLY_SECRET_KEY"] == "r"
    assert s["DJANGO_STACK"]["CONTENT_APPS"] == ["blog"]
