import time

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.utils import OperationalError


class Command(BaseCommand):
    help = "Wait until the database accepts connections."

    def add_arguments(self, parser):
        parser.add_argument("--timeout", type=int, default=60, help="Seconds to wait (default 60).")

    def handle(self, *args, timeout=60, **options):
        deadline = time.monotonic() + timeout
        while True:
            try:
                connection.ensure_connection()
                return
            except OperationalError as error:
                if time.monotonic() > deadline:
                    raise CommandError(
                        f"The database is not reachable after {timeout} seconds: {error}"
                    ) from error
                time.sleep(1)
