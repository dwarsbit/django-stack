"""
The widgets of the dashboard at /admin/: config/studio.py lists them. See
https://djangocontentstudio.org/docs/dashboard for the widget types.
"""

from datetime import timedelta

from content_studio.dashboard.content_list import ContentListWidget
from content_studio.dashboard.statistic import StatisticWidget
from content_studio.settings import cs_settings
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.utils.text import Truncator
from rest_framework.exceptions import PermissionDenied

from .models import FormSubmission


def check_view_permission(request, model):
    """Widgets show only what the editor may view in the model's own list."""
    studio = cs_settings.ADMIN_SITE._registry.get(model)
    if studio is None or not studio.has_view_permission(request):
        raise PermissionDenied()


class PublishedCountWidget(StatisticWidget):
    """The number of published objects of a model, with its drafts in the footnote."""

    name = "PublishedCount"
    refresh_interval = 300

    def __init__(self, model, title: str, icon: str = "", widget_id=None):
        self.model = model
        self.title = title
        self.icon = icon
        super().__init__(widget_id)

    def get_id_parts(self):
        return (self.name, self.model._meta.label)

    def get_data(self, request):
        check_view_permission(request, self.model)
        published = self.model.objects.published().count()
        drafts = self.model.objects.filter(status=self.model.Status.DRAFT).count()
        return {
            "title": self.title,
            "value": published,
            "number_format": "full",
            "icon": self.icon,
            "footnote": f"{drafts} draft{'' if drafts == 1 else 's'}",
        }


class SubmissionCountWidget(StatisticWidget):
    """The contact form submissions of the last 30 days, with one bar a day."""

    name = "SubmissionCount"
    refresh_interval = 300
    days = 30

    def get_data(self, request):
        check_view_permission(request, FormSubmission)
        today = timezone.localdate()
        first = today - timedelta(days=self.days - 1)
        per_day = dict(
            FormSubmission.objects.filter(created_at__date__gte=first)
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(count=Count("pk"))
            .values_list("day", "count")
        )
        series = [per_day.get(first + timedelta(days=offset), 0) for offset in range(self.days)]
        return {
            "title": "Form submissions",
            "value": sum(series),
            "number_format": "full",
            "icon": "ph-bold ph-envelope-simple",
            "footnote": f"Last {self.days} days",
            "series": series,
        }


class RecentSubmissionsWidget(ContentListWidget):
    """The latest contact form submissions, each linking to its page in the admin."""

    name = "RecentSubmissions"
    refresh_interval = 60
    limit = 5

    def get_data(self, request):
        check_view_permission(request, FormSubmission)
        latest = FormSubmission.objects.order_by("-created_at")[: self.limit]
        return {
            "title": "Recent form submissions",
            "description": "The latest messages from the contact form.",
            "content": [
                {
                    "model": FormSubmission._meta.label_lower,
                    "id": str(submission.pk),
                    "title": submission.name,
                    "description": Truncator(submission.message).chars(120),
                    "timestamp": submission.created_at,
                }
                for submission in latest
            ],
        }
