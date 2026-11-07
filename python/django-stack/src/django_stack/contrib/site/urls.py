from django.urls import path

from .views import preview, preview_exit

urlpatterns = [
    path("preview", preview, name="site-preview"),
    path("preview/exit", preview_exit, name="site-preview-exit"),
]
