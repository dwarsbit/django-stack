import pytest
from django.core.exceptions import ImproperlyConfigured

from django_stack.env import Env, parse_cache_url, parse_database_url, parse_email_url


def test_postgres_url():
    config = parse_database_url("postgres://app:p%40ss@db:5432/site?sslmode=require")
    assert config["ENGINE"] == "django.db.backends.postgresql"
    assert config["NAME"] == "site"
    assert config["USER"] == "app"
    assert config["PASSWORD"] == "p@ss"
    assert config["HOST"] == "db"
    assert config["PORT"] == "5432"
    assert config["OPTIONS"] == {"sslmode": "require"}


def test_sqlite_url():
    assert parse_database_url("sqlite:////srv/db.sqlite3")["NAME"] == "/srv/db.sqlite3"
    assert parse_database_url("sqlite://:memory:")["NAME"] == ":memory:"


def test_unsupported_database_url():
    with pytest.raises(ImproperlyConfigured):
        parse_database_url("mysql://localhost/db")


def test_cache_urls():
    assert parse_cache_url("redis://cache:6379/0")["BACKEND"].endswith("RedisCache")
    assert parse_cache_url("valkey://cache:6379/0")["LOCATION"] == "redis://cache:6379/0"
    assert parse_cache_url("locmem://")["BACKEND"].endswith("LocMemCache")
    database = parse_cache_url("db://", key_prefix="site")
    assert database["BACKEND"] == "django.core.cache.backends.db.DatabaseCache"
    assert database["LOCATION"] == "django_cache"
    assert database["KEY_PREFIX"] == "site"


def test_email_urls():
    smtp = parse_email_url("smtp://user:secret@mail.example.com:2525")["OPTIONS"]
    assert smtp["host"] == "mail.example.com"
    assert smtp["port"] == 2525
    assert smtp["password"] == "secret"
    assert parse_email_url("smtps://mail.example.com")["OPTIONS"]["use_ssl"] is True
    assert parse_email_url("console://")["BACKEND"].endswith("console.EmailBackend")


def test_env_values():
    env = Env({"FLAG": "yes", "COUNT": "3", "HOSTS": "a.com, b.com,", "EMPTY": ""})
    assert env.bool("FLAG") is True
    assert env.bool("MISSING", default=True) is True
    assert env.int("COUNT") == 3
    assert env.list("HOSTS") == ["a.com", "b.com"]
    assert env.str("EMPTY", "fallback") == "fallback"
    with pytest.raises(ImproperlyConfigured):
        env.str("MISSING", required=True)
    with pytest.raises(ImproperlyConfigured):
        Env({"FLAG": "maybe"}).bool("FLAG")


def test_postgres_url_has_no_persistent_connections():
    # Under ASGI a kept connection is never reused and they pile up (#94).
    assert parse_database_url("postgres://app:pw@db/app")["CONN_MAX_AGE"] == 0
