from django.apps import AppConfig
from django.db.models.signals import post_migrate


def create_tables(sender, using="default", **kwargs):
    """After `migrate`: the tables of a db:// cache and a db:// task queue."""
    from django.conf import settings
    from django.core.management import call_command

    call_command("createcachetable", database=using, verbosity=0)
    huey = getattr(settings, "HUEY", None)
    sql_queue = isinstance(huey, dict) and huey.get("huey_class") == "django_stack.huey.SqlHuey"
    if using == "default" and sql_queue:
        from huey.contrib.djhuey import HUEY

        HUEY.storage.create_tables()


class DjangoStackConfig(AppConfig):
    name = "django_stack"
    label = "django_stack"
    verbose_name = "DjangoStack"

    def ready(self):
        from . import checks  # noqa: F401 - registers the system checks

        post_migrate.connect(create_tables, sender=self, dispatch_uid="django_stack_create_tables")

        try:
            from content_studio.signals import content_changed
        except ImportError:  # pragma: no cover - Content Studio is not installed
            return

        from .contrib.revalidate.receivers import on_content_changed

        content_changed.connect(on_content_changed, dispatch_uid="django_stack_revalidate")
