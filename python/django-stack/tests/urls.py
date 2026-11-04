from django.urls import include, path

urlpatterns = [
    path("api/", include("headless.rest.urls")),
    path("", include("django_stack.urls")),
]
