from django.core.management.base import BaseCommand, CommandError

from django_stack import backup


class Command(BaseCommand):
    help = "Replace the media directory with an archive made by backup_database."

    def add_arguments(self, parser):
        parser.add_argument("backup", help="A .media.tar.gz name from `backup_database --list`, or a path.")
        parser.add_argument("--yes", action="store_true", help="Don't ask for confirmation.")

    def handle(self, *args, yes=False, **options):
        if not backup.media_on_disk():
            raise CommandError("Uploads are stored in S3, not on disk; restore them from the bucket.")
        try:
            path = backup.fetch_backup(options["backup"])
        except FileNotFoundError as error:
            raise CommandError(str(error)) from error
        if not yes:
            answer = input(f"Replace the media with {path.name}? Files uploaded since are lost. Type 'yes': ")
            if answer.strip().lower() != "yes":
                raise CommandError("Not restored.")
        try:
            backup.restore_media(path)
        except Exception as error:
            raise CommandError(f"Could not restore {path.name}: {error}") from error
        self.stdout.write(self.style.SUCCESS(f"Restored the media from {path.name}."))
