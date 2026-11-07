from django.urls import include, path
from django_stack.urls import media_urlpatterns
# @if !frontend
from django_stack.views import start
# @end

urlpatterns = [
    path("admin/", include("content_studio.urls")),
    path("api/", include("headless.rest.urls")),
    path("", include("django_stack.urls")),  # /healthz and /readyz
    *media_urlpatterns(),  # uploaded files, in development only
    # @if !frontend
    path("", start),  # a start page with links to the admin and the API schema
    # @end
]
