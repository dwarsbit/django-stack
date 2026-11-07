from django.urls import path

from . import analytics
from .views import preview, preview_exit

urlpatterns = [
    path("preview", preview, name="site-preview"),
    path("preview/exit", preview_exit, name="site-preview-exit"),
    # Umami's tracker and page views, where no reverse proxy serves /_a/ (development).
    path("_a/script.js", analytics.tracker, name="site-analytics-tracker"),
    path("_a/api/send", analytics.send, name="site-analytics-send"),
]
