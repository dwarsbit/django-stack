from django.core.management.base import BaseCommand, CommandError

from django_stack import health


class Command(BaseCommand):
    help = "Show the database, cache, worker and backup checks; exit 1 when one fails."

    def handle(self, *args, **options):
        checks = health.status()
        for name, result in checks.items():
            style = {"ok": self.style.SUCCESS, "error": self.style.ERROR}.get(result, str)
            self.stdout.write(f"{name:<10}{style(result)}")
        if not health.healthy(checks):
            failed = ", ".join(name for name, result in checks.items() if result == "error")
            raise CommandError(f"Failed: {failed}.")
