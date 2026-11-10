from django.core.exceptions import FieldDoesNotExist
from rest_framework.exceptions import ParseError
from rest_framework.filters import BaseFilterBackend

from ..preview import has_preview_access, published


class PublishedFilter(BaseFilterBackend):
    """
    Serve only published objects of models whose queryset has a
    ``published()`` method, such as models built on
    ``django_stack.models.PublishableModel``. Requests with a valid preview
    token and requests with the full-access key see drafts too.

    Without draft access, a filter may not cross a relation into such a
    model either, such as ``?posts__title__startswith=`` on authors: it
    would tell which drafts exist.
    """

    def filter_queryset(self, request, queryset, view):
        drafts = can_see_drafts(request)
        if not drafts and getattr(view, "action", None) == "list":
            for key in request.query_params:
                path = key.lstrip(exclusion_symbol())
                if crosses_into_publishable(queryset.model, path):
                    raise ParseError(detail=f"Field '{path.split('__')[0]}' does not exist")
        return published(queryset, drafts=drafts)


def exclusion_symbol() -> str:
    try:
        from headless.settings import headless_settings

        return headless_settings.FILTER_EXCLUSION_SYMBOL or "~"
    except ImportError:  # pragma: no cover - Django Headless is not installed
        return "~"


def is_publishable(model) -> bool:
    """Whether ``model``'s objects have a draft state: its queryset has a ``published()`` method."""
    return model is not None and hasattr(model._default_manager.all(), "published")


def crosses_into_publishable(model, path: str) -> bool:
    """Whether a lookup path such as ``posts__title`` follows a relation into a publishable model."""
    for part in path.split("__"):
        try:
            field = model._meta.get_field(part)
        except FieldDoesNotExist:
            return False
        if not field.is_relation or field.related_model is None:
            return False
        model = field.related_model
        if is_publishable(model):
            return True
    return False


def can_see_drafts(request) -> bool:
    """A request with a valid preview token, the full-access key or a staff login."""
    return request is not None and (has_preview_access(request) or is_full_access(request))


def is_full_access(request) -> bool:
    """A request with the full-access key, or from a logged-in staff user."""
    auth = getattr(request, "auth", None)
    if auth is not None and getattr(auth, "read_only", None) is False:
        return True
    user = getattr(request, "user", None)
    return bool(user and user.is_authenticated and user.is_staff and user.pk is not None)
