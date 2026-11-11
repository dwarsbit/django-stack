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
    assert s["HUEY_STATS"] == {"database": "psycopg3://app:pw@db/app"}


POSTGRES = {"DATABASE_URL": "postgres://app:pw@db/app?sslmode=require", "PROJECT_NAME": "site"}


def test_tasks_in_the_database():
    s = run({**POSTGRES, "CACHE_URL": "db://", "TASKS_URL": "db://"})
    assert s["CACHES"]["default"]["BACKEND"].endswith("DatabaseCache")
    assert s["HUEY"]["huey_class"] == "django_stack.huey.SqlHuey"
    assert s["HUEY"]["database"] == "psycopg3://app:pw@db/app?sslmode=require"
    assert s["HUEY"]["create_tables"] is False
    assert s["HUEY"]["immediate"] is False
    assert s["TASKS"]["default"]["BACKEND"] == "huey.contrib.djhuey.tasks_backend.HueyBackend"


@pytest.mark.parametrize("scheme", ["postgresql", "pgsql", "postgis"])
def test_tasks_in_the_database_with_every_postgres_scheme(scheme):
    s = run({"DATABASE_URL": f"{scheme}://app:pw@db/app", "TASKS_URL": "db://"})
    assert s["HUEY"]["database"] == "psycopg3://app:pw@db/app"
    assert s["HUEY_STATS"] == {"database": "psycopg3://app:pw@db/app"}


def test_tasks_in_a_sqlite_database():
    s = run({"DATABASE_URL": "sqlite:////srv/app/db.sqlite3", "TASKS_URL": "db://"})
    assert s["HUEY"]["database"] == "sqlite:////srv/app/db.sqlite3"


def test_tasks_on_valkey_with_the_database_cache():
    s = run({**POSTGRES, "CACHE_URL": "db://", "TASKS_URL": "valkey://cache:6379/1"})
    assert s["HUEY"]["huey_class"] == "huey.RedisHuey"
    assert s["HUEY"]["connection"] == {"url": "redis://cache:6379/1"}


def test_tasks_in_the_request():
    s = run({**POSTGRES, "CACHE_URL": "redis://cache:6379/0", "TASKS_URL": "immediate://"})
    assert s["HUEY"]["immediate"] is True
    assert s["TASKS"]["default"]["BACKEND"].endswith("ImmediateBackend")


def test_tasks_without_tasks_url_follow_a_redis_cache():
    assert run({**POSTGRES, "CACHE_URL": "db://"})["HUEY"]["immediate"] is True
    assert run({**POSTGRES, "CACHE_URL": "redis://cache:6379/0"})["HUEY"]["huey_class"] == "huey.RedisHuey"


def test_unknown_tasks_url():
    with pytest.raises(ImproperlyConfigured):
        run({**POSTGRES, "TASKS_URL": "amqp://queue"})


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


def test_s3_public_url():
    s = run(
        {
            "S3_BUCKET": "media",
            "S3_ENDPOINT_URL": "http://s3:8333",
            "S3_PUBLIC_URL": "http://localhost:8333/media/",
        }
    )
    options = s["STORAGES"]["default"]["OPTIONS"]
    assert options["custom_domain"] == "localhost:8333/media"
    assert options["url_protocol"] == "http:"
    assert s["MEDIA_URL"] == "http://localhost:8333/media/"


def test_deploy_checks_that_do_not_apply_are_silenced():
    s = run({"SITE_URL": "https://example.com", "NUM_PROXIES": "1"})
    assert {"security.W005", "security.W008", "security.W021"} <= set(s["SILENCED_SYSTEM_CHECKS"])
    s = run({"SITE_URL": "https://example.com"})
    assert "security.W008" not in s["SILENCED_SYSTEM_CHECKS"]
    assert run({"SITE_URL": "http://localhost:3000"})["SILENCED_SYSTEM_CHECKS"] == []


def test_backup_settings():
    s = run({"BACKUP_S3_BUCKET": "backups", "S3_ACCESS_KEY_ID": "key", "BACKUP_KEEP": "7"})
    stack = s["DJANGO_STACK"]
    assert stack["BACKUP_S3_BUCKET"] == "backups"
    assert stack["BACKUP_KEEP"] == 7
    assert stack["BACKUP_S3"]["access_key"] == "key"
    assert stack["BACKUP_DIR"] == "/srv/app/backups"
