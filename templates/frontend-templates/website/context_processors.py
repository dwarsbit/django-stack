from django.utils.functional import SimpleLazyObject

from content.models import Menu, SiteSettings


def menu(slug):
    return Menu.objects.filter(slug=slug).first()


def site(request):
    """The site settings and the menus, for base.html; read only when a template uses them."""
    return {
        "site": SimpleLazyObject(lambda: SiteSettings.objects.select_related("home_page").first()),
        "main_menu": SimpleLazyObject(lambda: menu("main")),
        "footer_menu": SimpleLazyObject(lambda: menu("footer")),
    }
