from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from ... import conf


class Command(BaseCommand):
    help = (
        "Create the first admin user from ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD. "
        "Does nothing when the user exists."
    )

    def handle(self, *args, **options):
        username = conf.get("ADMIN_USERNAME")
        password = conf.get("ADMIN_PASSWORD")
        email = conf.get("ADMIN_EMAIL") or ""

        if not username or not password:
            self.stdout.write("ADMIN_USERNAME or ADMIN_PASSWORD is not set; no admin user created.")
            return

        User = get_user_model()  # noqa: N806
        lookup = {User.USERNAME_FIELD: username}
        if User._default_manager.filter(**lookup).exists():
            self.stdout.write(f"The admin user {username!r} exists.")
            return

        extra = {"email": email} if "email" in {f.name for f in User._meta.get_fields()} else {}
        User._default_manager.create_superuser(**lookup, password=password, **extra)
        self.stdout.write(self.style.SUCCESS(f"Created the admin user {username!r}."))
