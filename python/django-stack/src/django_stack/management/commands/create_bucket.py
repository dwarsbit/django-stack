from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Create the S3 media bucket when it does not exist; for the development S3 service."

    def handle(self, *args, **options):
        storage = settings.STORAGES["default"]
        if not storage["BACKEND"].startswith("storages.backends.s3"):
            raise CommandError("Media is not stored in S3: set S3_BUCKET.")
        from django.core.files.storage import default_storage

        client = default_storage.connection.meta.client
        bucket = default_storage.bucket_name
        existing = {item["Name"] for item in client.list_buckets().get("Buckets", [])}
        if bucket in existing:
            self.stdout.write(f"The bucket {bucket} exists.")
            return
        client.create_bucket(Bucket=bucket)
        self.stdout.write(self.style.SUCCESS(f"Created the bucket {bucket}."))
