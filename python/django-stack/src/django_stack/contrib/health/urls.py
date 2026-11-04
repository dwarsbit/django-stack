from django.urls import path

from . import views

urlpatterns = [
    path("healthz", views.healthz, name="django-stack-healthz"),
    path("readyz", views.readyz, name="django-stack-readyz"),
]
