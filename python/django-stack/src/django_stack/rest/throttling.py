from rest_framework.permissions import SAFE_METHODS
from rest_framework.throttling import SimpleRateThrottle


class PublicWriteThrottle(SimpleRateThrottle):
    """
    Limits writes without a key or login on the generated routes, such as
    contact form submissions, per client IP address. Set the rate with
    the PUBLIC_WRITE_THROTTLE_RATE environment variable (default 10/minute).
    """

    scope = "public_write"

    def get_cache_key(self, request, view):
        if request.method in SAFE_METHODS or getattr(view, "headless_model", None) is None:
            return None
        if request.auth is not None or (request.user and request.user.is_authenticated):
            return None
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}
