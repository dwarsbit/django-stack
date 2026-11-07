from django.apps import AppConfig


class SiteConfig(AppConfig):
    name = "django_stack.contrib.site"
    label = "django_stack_site"
    verbose_name = "DjangoStack site"

    def ready(self):
        from .receivers import connect

        connect()
