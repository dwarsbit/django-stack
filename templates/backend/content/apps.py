from django.apps import AppConfig, apps


class ContentConfig(AppConfig):
    name = "content"
    verbose_name = "Content"

    def ready(self):
        if apps.is_installed("content_studio.notifications"):
            from . import notifications  # noqa: F401 - registers the events
