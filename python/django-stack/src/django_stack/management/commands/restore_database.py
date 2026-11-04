import subprocess

from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError

from django_stack import backup


class Command(BaseCommand):
    help = "Restore a backup made by backup_database over the current database."

    def add_arguments(self, parser):
        parser.add_argument("backup", help="A file name from `backup_database --list`, or a path to a dump.")
        parser.add_argument("--yes", action="store_true", help="Don't ask for confirmation.")

    def handle(self, *args, yes=False, **options):
        try:
            path = backup.fetch_backup(options["backup"])
        except FileNotFoundError as error:
            raise CommandError(str(error)) from error
        if not yes:
            answer = input(f"Restore {path.name}? Content saved since the backup is lost. Type 'yes': ")
            if answer.strip().lower() != "yes":
                raise CommandError("Not restored.")
        try:
            backup.restore_backup(path)
        except ImproperlyConfigured as error:
            raise CommandError(str(error)) from error
        except subprocess.CalledProcessError as error:
            raise CommandError(
                f"pg_restore failed: {error.stderr.decode(errors='replace').strip()}"
            ) from error
        self.stdout.write(self.style.SUCCESS(f"Restored {path.name}."))
