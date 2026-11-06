from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from django_stack import health


@never_cache
@require_GET
def healthz(request):
    """The process is up."""
    return JsonResponse({"status": "ok"})


def _report(checks):
    ok = health.healthy(checks)
    return JsonResponse({"status": "ok" if ok else "error", "checks": checks}, status=200 if ok else 503)


@never_cache
@require_GET
def readyz(request):
    """The database and the cache are reachable."""
    return _report(health.ready())


@never_cache
@require_GET
def statusz(request):
    """Every check: also the worker's heartbeat and the age of the last daily backup."""
    return _report(health.status())
