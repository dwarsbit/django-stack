from types import SimpleNamespace

import peewee
import pytest
from huey.contrib import stats

from django_stack.studio import HueyAdapter


@pytest.fixture
def events(tmp_path):
    db = peewee.SqliteDatabase(str(tmp_path / "stats.db"))
    stats.database.initialize(db)
    db.create_tables(stats.MODELS)
    yield stats.HueyEvent
    db.close()


def test_recent_runs_leave_out_the_heartbeat(events):
    heartbeat = "django_stack.tasks.heartbeat"
    for ts, task in enumerate(["app.tasks.send_mail", heartbeat, heartbeat]):
        events.create(ts=ts, queue="site", task_id=str(ts), task=task, signal="complete", duration=0.1)
    adapter = HueyAdapter(huey=SimpleNamespace(name="site", _stats=SimpleNamespace(name="site")))

    rows = adapter.get_recent_tasks(None, limit=2)

    assert [(row.title, row.description) for row in rows] == [("send_mail", "app.tasks")]
