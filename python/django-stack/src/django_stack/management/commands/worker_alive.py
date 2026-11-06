from django.core.management.base import BaseCommand, CommandError

from django_stack import health


class Command(BaseCommand):
    help = "Exit 1 when the worker has not stamped its heartbeat in the last three minutes."

    def handle(self, *args, **options):
        result = health.check_worker()
        if result == "error":
            raise CommandError("The worker has not run its heartbeat task in the last three minutes.")
        self.stdout.write(f"worker: {result}")
