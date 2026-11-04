from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Import content exported with export_content."

    def add_arguments(self, parser):
        parser.add_argument("path", help="The JSON file export_content wrote.")

    def handle(self, *args, path, **options):
        call_command("loaddata", path, stdout=self.stdout)
