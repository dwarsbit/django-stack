from __future__ import annotations

from django.apps import apps
from django.http import HttpResponsePermanentRedirect, HttpResponseRedirect

from ... import conf


class RedirectMiddleware:
    """
    Answers a 404 to GET or HEAD with the redirect an editor set for the
    path, from the model in ``DJANGO_STACK["SITE_REDIRECT_MODEL"]``, which
    has ``old_path``, ``new_path`` and ``permanent`` fields.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if response.status_code != 404 or request.method not in ("GET", "HEAD"):
            return response
        try:
            model = apps.get_model(conf.get("SITE_REDIRECT_MODEL"))
        except (LookupError, ValueError):
            return response
        old_path = "/" + request.path.strip("/")
        redirect = model.objects.filter(old_path=old_path).first()
        if redirect is None or not redirect.new_path:
            return response
        response_class = HttpResponsePermanentRedirect if redirect.permanent else HttpResponseRedirect
        return response_class(redirect.new_path)
