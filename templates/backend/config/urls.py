from django.urls import include, path
from django_stack.urls import media_urlpatterns

urlpatterns = [
    path("admin/", include("content_studio.urls")),
    path("api/", include("headless.rest.urls")),
    path("", include("django_stack.urls")),  # /healthz and /readyz
    *media_urlpatterns(),  # uploaded files, in development only
    # @if headless
    path("", include("django_stack.start")),  # a start page with links to the admin and the API schema
    # @end
    # @if templates
    path("", include("website.urls")),  # the site's pages, last: they include a catch-all for page paths
    # @end
]
# @if templates

# The site's 404 page, with its layout (when DJANGO_DEBUG is off).
handler404 = "website.views.not_found"
# @end
