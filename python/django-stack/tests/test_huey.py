from django.core.management import call_command
from django.db import connection

from django_stack.huey import SqlHuey


def test_sql_queue_prefixes_its_tables(tmp_path):
    huey = SqlHuey("site", database=f"sqlite:///{tmp_path / 'queue.db'}", create_tables=False)
    huey.storage.create_tables()
    assert {model._meta.table_name for model in (huey.storage.Task, huey.storage.KV)} == {
        "huey_task",
        "huey_kv",
    }

    @huey.task()
    def add(a, b):
        return a + b

    result = add(1, 2)
    assert huey.pending_count() == 1
    huey.execute(huey.dequeue())
    assert result.get() == 3


def test_migrate_creates_the_cache_table(db, settings):
    settings.CACHES = {
        "default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "django_cache"}
    }
    call_command("migrate", verbosity=0)
    assert "django_cache" in connection.introspection.table_names()
