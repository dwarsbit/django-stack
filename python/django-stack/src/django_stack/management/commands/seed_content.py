from django.core.management.base import BaseCommand, CommandError
from django.utils.module_loading import import_string

from ... import conf


class Command(BaseCommand):
    help = "Fill the site with demo content, with the function DJANGO_STACK['SEED_CONTENT'] names."

    def add_arguments(self, parser):
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help="Only seed when the function reports the site has no content yet.",
        )

    def handle(self, *args, if_empty=False, **options):
        path = conf.get("SEED_CONTENT")
        if not path:
            raise CommandError("Set DJANGO_STACK['SEED_CONTENT'] to the dotted path of a seed function.")
        seed = import_string(path)
        created = seed(if_empty=if_empty, stdout=self.stdout)
        if created is False:
            self.stdout.write("The site has content; nothing seeded.")
        else:
            self.stdout.write(self.style.SUCCESS("Seeded the demo content."))
