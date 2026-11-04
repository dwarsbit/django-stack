from rest_framework.permissions import SAFE_METHODS, BasePermission

from .. import conf


def model_label(view) -> str | None:
    model = getattr(view, "headless_model", None)
    return model._meta.label_lower if model is not None else None


def is_public_create(view) -> bool:
    label = model_label(view)
    return label is not None and label in {name.lower() for name in conf.get("PUBLIC_CREATE")}


class StackPermission(BasePermission):
    """
    The permission of the generated routes.

    - Staff users and the full-access key may do everything.
    - The read-only key may read, except models in ``PUBLIC_CREATE``,
      such as form submissions, which only the full-access key reads.
    - Everyone may create objects of models in ``PUBLIC_CREATE``; the
      ``PublicWriteThrottle`` limits how often.
    - Everything else is refused.
    """

    def has_permission(self, request, view):
        user = request.user
        auth = request.auth
        public_create = is_public_create(view)

        if getattr(auth, "read_only", None) is True:
            return request.method in SAFE_METHODS and not public_create

        if user and user.is_staff:
            return True

        return public_create and request.method == "POST" and getattr(view, "action", None) == "create"
