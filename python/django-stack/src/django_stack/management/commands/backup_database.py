import subprocess

from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError

from django_stack import backup


class Command(BaseCommand):
    help = (
        "Back up the database with pg_dump and, when uploads are on disk, the media directory, "
        "to BACKUP_DIR and the backup bucket, and apply the retention."
    )

    def add_arguments(self, parser):
        parser.add_argument("--keep", type=int, help="How many backups to keep (default: BACKUP_KEEP).")
        parser.add_argument("--list", action="store_true", help="List the backups instead of making one.")
        parser.add_argument("--no-media", action="store_true", help="Back up only the database.")

    def handle(self, *args, keep=None, list=False, no_media=False, **options):
        if list:
            for pattern in (backup.NAME_PATTERN, backup.MEDIA_PATTERN):
                for name in backup.local_backups(pattern):
                    self.stdout.write(f"local  {name}")
                for name in backup.remote_backups(pattern):
                    self.stdout.write(f"bucket {name}")
            return
        try:
            result = backup.create_backup(keep=keep)
        except ImproperlyConfigured as error:
            raise CommandError(str(error)) from error
        except subprocess.CalledProcessError as error:
            raise CommandError(f"pg_dump failed: {error.stderr.decode(errors='replace').strip()}") from error
        where = " and the backup bucket" if result.uploaded else ""
        self.stdout.write(self.style.SUCCESS(f"Backed up the database to {result.path}{where}."))
        if no_media or not backup.media_backups_enabled():
            return
        media = backup.create_media_backup(result.name, keep=keep)
        where = " and the backup bucket" if media.uploaded else ""
        self.stdout.write(self.style.SUCCESS(f"Backed up the media to {media.path}{where}."))
