import time

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.utils import OperationalError

# Postgres sets the password only when it creates its data. A volume left by
# an earlier project with the same name keeps the old one, so a new .env never
# matches it, and waiting does not help.
STALE_VOLUME_HELP = (
    "The database rejects the password in DATABASE_URL. When the bundled Postgres "
    "has data from an earlier project with the same name, it keeps that project's "
    "password. To start over with an empty database, run `docker compose down "
    "--volumes` in the project (this deletes its database and uploads), then start "
    "it again. Otherwise set POSTGRES_PASSWORD and DATABASE_URL in .env to the "
    "password of that data."
)


def check_connection():
    """Open a connection, around the pool when DATABASE_POOL is on.

    A pool retries a failed connection in the background and only reports a
    timeout, which hides the reason and the password help below.
    """
    if connection.vendor == "postgresql" and connection.settings_dict["OPTIONS"].get("pool"):
        with connection.wrap_database_errors:
            connection.Database.connect(**connection.get_connection_params()).close()
    else:
        connection.ensure_connection()


class Command(BaseCommand):
    help = "Wait until the database accepts connections."

    def add_arguments(self, parser):
        parser.add_argument("--timeout", type=int, default=60, help="Seconds to wait (default 60).")

    def handle(self, *args, timeout=60, **options):
        deadline = time.monotonic() + timeout
        while True:
            try:
                check_connection()
                return
            except OperationalError as error:
                if "password authentication failed" in str(error):
                    raise CommandError(f"{error}\n{STALE_VOLUME_HELP}") from error
                if time.monotonic() > deadline:
                    raise CommandError(
                        f"The database is not reachable after {timeout} seconds: {error}"
                    ) from error
                time.sleep(1)
