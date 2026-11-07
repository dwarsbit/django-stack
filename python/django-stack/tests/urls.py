from django.urls import include, path

from tests.testapp import views

urlpatterns = [
    path("api/", include("headless.rest.urls")),
    path("", include("django_stack.urls")),
    path("", include("django_stack.contrib.site.urls")),
    path("blog/<slug:slug>", views.article),
    path("contact", views.contact),
]
