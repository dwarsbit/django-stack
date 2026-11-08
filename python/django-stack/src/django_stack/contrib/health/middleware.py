"""
Answers ``/healthz`` and ``/readyz`` before Django checks the Host header.

A platform's health check calls the container by its own address, such as
``http://10.13.220.205:8000/readyz`` on Bunny Magic Containers, and that
address is not in ``ALLOWED_HOSTS``. This middleware serves the two checks
for any host, so ``ALLOWED_HOSTS`` stays closed for every other path. Put it
right after ``RequestIdMiddleware``, before ``SecurityMiddleware``::

    MIDDLEWARE = [
        "django_stack.logs.RequestIdMiddleware",
        "django_stack.contrib.health.middleware.HealthCheckMiddleware",
        "django.middleware.security.SecurityMiddleware",
        ...
    ]
"""

from __future__ import annotations

from . import views

CHECKS = {"/healthz": views.healthz, "/readyz": views.readyz}


class HealthCheckMiddleware:
    """Serves the health checks for any Host header; everything else goes on."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        view = CHECKS.get(request.path_info)
        if view is not None:
            return view(request)
        return self.get_response(request)
