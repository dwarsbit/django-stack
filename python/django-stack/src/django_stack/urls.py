"""
DjangoStack's URLs: the health checks at /healthz and /readyz.

    # config/urls.py
    from django_stack.urls import media_urlpatterns

    urlpatterns = [
        ...,
        path("", include("django_stack.urls")),
        *media_urlpatterns(),
    ]
"""

from urllib.parse import urlsplit

from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve

urlpatterns = [
    path("", include("django_stack.contrib.health.urls")),
]


def media_urlpatterns():
    """
    Serves uploaded files in development, when DEBUG is on.

    Django's ``static()`` helper skips an absolute MEDIA_URL such as
    ``http://localhost:3000/media/``, which DjangoStack uses so the API
    returns absolute file URLs. This serves the path of that URL instead.
    In production the reverse proxy or the S3 bucket serves the files.
    """
    if not settings.DEBUG or not settings.MEDIA_URL:
        return []
    prefix = urlsplit(settings.MEDIA_URL).path.strip("/")
    if not prefix:
        return []
    return [
        re_path(rf"^{prefix}/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    ]
