from rest_framework.filters import BaseFilterBackend

from ..preview import has_preview_access, published


class PublishedFilter(BaseFilterBackend):
    """
    Serve only published objects of models whose queryset has a
    ``published()`` method, such as models built on
    ``django_stack.models.PublishableModel``. Requests with a valid preview
    token and requests with the full-access key see drafts too.
    """

    def filter_queryset(self, request, queryset, view):
        return published(queryset, drafts=has_preview_access(request) or is_full_access(request))


def is_full_access(request) -> bool:
    """A request with the full-access key, or from a logged-in staff user."""
    auth = getattr(request, "auth", None)
    if auth is not None and getattr(auth, "read_only", None) is False:
        return True
    user = getattr(request, "user", None)
    return bool(user and user.is_authenticated and user.is_staff and user.pk is not None)
