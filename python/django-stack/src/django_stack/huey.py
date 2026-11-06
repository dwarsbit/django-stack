"""
Huey's SQL queue with its tables named huey_*, for TASKS_URL=db://.

Huey's own SqlStorage names its tables kv, schedule, task and counter,
which are easy to clash with a project's models. `migrate` creates the
tables (see apps.py), so the web process never creates them on import.
"""

from __future__ import annotations

from functools import partial

from huey import Huey
from huey.contrib.sql_huey import SqlStorage as BaseSqlStorage


class SqlStorage(BaseSqlStorage):
    def create_models(self):
        models = super().create_models()
        for model in models:
            model._meta.set_table_name(f"huey_{model._meta.table_name}")
        # The task index was made for the old name: make it again.
        task = models[2]
        task._meta.indexes = [index for index in task._meta.indexes if isinstance(index, tuple)]
        task.add_index(task.priority.desc(), task.id)
        return models


SqlHuey = partial(Huey, storage_class=SqlStorage)
