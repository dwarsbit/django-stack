from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from django_stack import conf
from django_stack.analytics import DEFAULT_PASSWORD, UmamiClient, UmamiError
from django_stack.env import hostname


class Command(BaseCommand):
    help = (
        "Prepare the bundled Umami: replace its default admin password with UMAMI_ADMIN_PASSWORD "
        "and create the website UMAMI_WEBSITE_ID for SITE_URL. Safe to run on every start."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--timeout", type=int, default=120, help="Seconds to wait for Umami to start (default 120)."
        )

    def handle(self, *args, timeout=120, **options):
        url = conf.get("UMAMI_URL")
        website_id = conf.get("UMAMI_WEBSITE_ID")
        username = conf.get("UMAMI_USERNAME")
        password = conf.get("UMAMI_PASSWORD")
        if not url:
            raise CommandError("Analytics are off: set UMAMI_URL.")
        if not website_id or not password:
            raise CommandError("Set UMAMI_WEBSITE_ID and UMAMI_ADMIN_PASSWORD.")
        if len(password) < 8:
            raise CommandError("UMAMI_ADMIN_PASSWORD must have at least 8 characters.")

        client = UmamiClient(url)
        try:
            client.wait(timeout)
            self.sign_in(client, username, password)
            self.ensure_website(client, website_id)
        except UmamiError as error:
            raise CommandError(str(error)) from error

    def sign_in(self, client: UmamiClient, username: str, password: str) -> None:
        try:
            client.login(username, password)
            return
        except UmamiError as error:
            if error.status != 401:
                raise
        # A new Umami still has the default password: replace it.
        try:
            client.login(username, DEFAULT_PASSWORD)
        except UmamiError as error:
            if error.status == 401:
                raise UmamiError(
                    "Umami refused UMAMI_ADMIN_PASSWORD for its admin user. Set the password it has."
                ) from error
            raise
        client.call(
            "POST", "/api/me/password", {"currentPassword": DEFAULT_PASSWORD, "newPassword": password}
        )
        client.login(username, password)
        self.stdout.write(self.style.SUCCESS("Replaced Umami's default admin password."))

    def ensure_website(self, client: UmamiClient, website_id: str) -> None:
        domain = hostname(settings.SITE_URL) or "localhost"
        name = getattr(settings, "PROJECT_NAME", None) or domain
        try:
            website = client.call("GET", f"/api/websites/{website_id}")
        except UmamiError as error:
            if error.status != 404:
                raise
            website = None
        if not website:
            # Umami answers null for a website it does not have.
            client.call("POST", "/api/websites", {"id": website_id, "name": name, "domain": domain})
            self.stdout.write(self.style.SUCCESS(f"Created the Umami website for {domain}."))
            return
        if website.get("domain") != domain:
            client.call("POST", f"/api/websites/{website_id}", {"name": name, "domain": domain})
            self.stdout.write(f"Set the Umami website's domain to {domain}.")
        else:
            self.stdout.write(f"The Umami website for {domain} exists.")
