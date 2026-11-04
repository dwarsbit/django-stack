from django.core.management import call_command
from django.core.management.base import BaseCommand

from ... import conf


class Command(BaseCommand):
    help = (
        "Export the content (the CONTENT_APPS and the media library) as JSON, "
        "for fixtures and moving between environments."
    )

    def add_arguments(self, parser):
        parser.add_argument("--output", "-o", help="The file to write; standard output by default.")

    def handle(self, *args, output=None, **options):
        labels = list(conf.get("CONTENT_APPS"))
        from django.apps import apps

        if apps.is_installed("content_studio.media_library"):
            labels.insert(0, "content_studio_media_library")
        call_command(
            "dumpdata",
            *labels,
            indent=2,
            natural_foreign=True,
            output=output,
            stdout=self.stdout,
        )
