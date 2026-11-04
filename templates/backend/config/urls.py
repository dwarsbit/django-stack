from django.urls import include, path
from django_stack.urls import media_urlpatterns

urlpatterns = [
    path("admin/", include("content_studio.urls")),
    path("api/", include("headless.rest.urls")),
    path("", include("django_stack.urls")),  # /healthz and /readyz
    *media_urlpatterns(),  # uploaded files, in development only
]
