from django.apps import AppConfig


class DjangoStackConfig(AppConfig):
    name = "django_stack"
    label = "django_stack"
    verbose_name = "DjangoStack"

    def ready(self):
        from . import checks  # noqa: F401 - registers the system checks

        try:
            from content_studio.signals import content_changed
        except ImportError:  # pragma: no cover - Content Studio is not installed
            return

        from .contrib.revalidate.receivers import on_content_changed

        content_changed.connect(on_content_changed, dispatch_uid="django_stack_revalidate")
