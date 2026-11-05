import subprocess

from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError

from django_stack import backup


class Command(BaseCommand):
    help = "Restore a backup made by backup_database over the current database."

    def add_arguments(self, parser):
        parser.add_argument("backup", help="A file name from `backup_database --list`, or a path to a dump.")
        parser.add_argument("--yes", action="store_true", help="Don't ask for confirmation.")
        parser.add_argument(
            "--media", action="store_true", help="Also restore the media archive made with this backup."
        )

    def handle(self, *args, yes=False, media=False, **options):
        try:
            path = backup.fetch_backup(options["backup"])
            media_path = backup.fetch_backup(backup.media_name(path.name)) if media else None
        except FileNotFoundError as error:
            raise CommandError(str(error)) from error
        if media and not backup.media_on_disk():
            raise CommandError("Uploads are stored in S3, not on disk; restore them from the bucket.")
        if not yes:
            what = f"{path.name} and its media" if media_path else path.name
            answer = input(f"Restore {what}? Content saved since the backup is lost. Type 'yes': ")
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
        if media_path:
            backup.restore_media(media_path)
            self.stdout.write(self.style.SUCCESS(f"Restored the media from {media_path.name}."))
