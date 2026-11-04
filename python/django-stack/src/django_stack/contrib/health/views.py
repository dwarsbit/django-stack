from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET


@never_cache
@require_GET
def healthz(request):
    """The process is up."""
    return JsonResponse({"status": "ok"})


@never_cache
@require_GET
def readyz(request):
    """The database and the cache are reachable."""
    checks = {}
    try:
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception:  # noqa: BLE001
        checks["database"] = "error"
    try:
        cache.set("django_stack:readyz", "1", 5)
        checks["cache"] = "ok" if cache.get("django_stack:readyz") == "1" else "error"
    except Exception:  # noqa: BLE001
        checks["cache"] = "error"

    ready = all(value == "ok" for value in checks.values())
    return JsonResponse(
        {"status": "ok" if ready else "error", "checks": checks}, status=200 if ready else 503
    )
