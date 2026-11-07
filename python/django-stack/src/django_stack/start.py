"""
The start page of a headless project, where no frontend serves ``/``.

    # config/urls.py
    urlpatterns = [..., path("", include("django_stack.start"))]
"""

from django.conf import settings
from django.template.response import TemplateResponse
from django.urls import path
from django.views.decorators.http import require_safe

CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


@require_safe
def start(request):
    """
    Links to the admin and the API schema. The API itself needs a key, so a
    visitor sees nothing more than these links.
    """
    response = TemplateResponse(
        request,
        "django_stack/start.html",
        {
            "project_name": getattr(settings, "PROJECT_NAME", ""),
            "schema": bool(getattr(settings, "HEADLESS", {}).get("SCHEMA")),
        },
    )
    # Plain HTML: no scripts, styles or frames.
    response["Content-Security-Policy"] = CSP
    return response


urlpatterns = [path("", start, name="django-stack-start")]
