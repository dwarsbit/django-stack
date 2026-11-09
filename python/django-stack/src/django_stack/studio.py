"""
Content Studio components for DjangoStack projects.

``SystemPage`` is a page of the admin for superusers, at ``/system/``: the
state of the database, the cache, the worker and the daily backup (see
``django_stack.health``), and the latest error reports
(``django_stack.errors``)::

    from django_stack.studio import SystemLink, SystemPage

    class SiteStudio(ContentStudioSite):
        extensions = [SystemPage(), SystemLink()]

``PreviewButton`` opens an object on the site with drafts shown. The
object's path on the site comes from its ``get_absolute_url()``::

    from django_stack.studio import PreviewButton

    @register(Page)
    class PageStudio(ModelStudio):
        edit_sidebar = ["status", "published_at", PreviewButton()]

``HueyAdapter`` is Content Studio's Huey adapter for the task dashboard,
without the worker's heartbeat in the recent runs: it runs every minute
and would push the real tasks out of the list::

    from django_stack.studio import HueyAdapter

    TASKS = HueyAdapter()
"""

from content_studio.contrib import huey as studio_huey
from content_studio.dashboard import Dashboard
from content_studio.dashboard.content_list import ContentListWidget
from content_studio.dashboard.tasks import TaskRow
from content_studio.extensions import DashboardPage, UserMenuLink
from content_studio.form import ButtonLink
from django.apps import apps
from django.utils.translation import gettext_lazy as _

from . import conf, errors, health
from .preview import preview_url


class PreviewButton(ButtonLink):
    label = "Preview"
    icon = "ph-bold ph-eye"

    def get_url(self, obj, request):
        get_path = getattr(obj, "get_absolute_url", None)
        path = get_path() if callable(get_path) else "/"
        return preview_url(path)


class HueyAdapter(studio_huey.HueyAdapter):
    """Content Studio's Huey adapter, with ``hidden_tasks`` left out of the recent runs."""

    #: Full Huey task names that never show in the recent runs.
    hidden_tasks = ("django_stack.tasks.heartbeat",)

    def get_recent_tasks(self, request, limit: int) -> list[TaskRow]:
        if self.stats is None:
            return []

        from huey.contrib.stats import HueyEvent

        events = (
            HueyEvent.select()
            .where(
                HueyEvent.queue == self.stats.name,
                HueyEvent.signal.in_(list(studio_huey.OUTCOMES)),
                HueyEvent.task.not_in(list(self.hidden_tasks)),
            )
            .order_by(HueyEvent.ts.desc(), HueyEvent.id.desc())
            .limit(limit)
        )
        rows = []
        for event in events:
            title, description = self.get_run_name(event)
            status, error = self.get_outcome(event)
            rows.append(
                TaskRow(
                    title=title,
                    description=description,
                    status=status,
                    last_run_at=studio_huey.from_timestamp(event.ts),
                    duration=studio_huey.seconds(event.duration),
                    error_message=error,
                )
            )
        return rows


def _superuser(request) -> bool:
    user = getattr(request, "user", None)
    return bool(user and user.is_active and user.is_superuser)


# The badge of each check result: its label and color.
STATUS = {
    "ok": (_("OK"), "success"),
    "error": (_("Failing"), "danger"),
    "active": (_("Active"), "info"),
    "off": (_("Off"), "default"),
}


class SystemStatusWidget(ContentListWidget):
    """The database, cache, worker and daily backup checks."""

    name = "DjangoStackSystemStatus"
    refresh_interval = 60

    def get_data(self, request):
        checks = health.status()
        rows = [
            (_("Database"), checks["database"], _("Postgres answers queries.")),
            (_("Cache"), checks["cache"], _("The cache stores and returns values.")),
            (
                _("Worker"),
                checks["worker"],
                _("Runs the tasks; checks in every minute. Off when tasks run in the request."),
            ),
            (
                _("Daily backup"),
                checks["backup"],
                _("Failing when the last backup is more than 26 hours old. Off when backups are turned off."),
            ),
        ]
        content = []
        for title, result, description in rows:
            label, variant = STATUS[result]
            content.append(
                {
                    "title": str(title),
                    "description": str(description),
                    "status": str(label),
                    "status_variant": variant,
                }
            )
        return {"title": str(_("Status")), "content": content}


class RecentErrorsWidget(ContentListWidget):
    """The latest error reports the viewer got as notifications, with how often each happened."""

    name = "DjangoStackRecentErrors"
    refresh_interval = 60

    def get_data(self, request):
        from content_studio.notifications.models import Notification

        latest = Notification.objects.filter(recipient=request.user, event=errors.EVENT)[:8]
        content = [
            {
                "title": notification.get_title()[:200] or str(_("Error")),
                "description": str(notification.params.get("logger", "")),
                "status": f"{notification.count}×",
                "status_variant": "danger",
                "timestamp": notification.updated_at,
            }
            for notification in latest
        ]
        return {
            "title": str(_("Recent errors")),
            "description": str(_("Each error is mailed once an hour at most; the count goes up.")),
            "content": content,
        }


class SystemPage(DashboardPage):
    """The System page of the admin, for superusers only."""

    path = "system/"
    title = _("System")
    description = _("The state of the site's services and its latest errors.")

    def __init__(self, path: str | None = None, **kwargs):
        widgets = [SystemStatusWidget()]
        # Error reports by email are also notifications; Sentry has its own page.
        if apps.is_installed("content_studio.notifications") and conf.get("ERRORS") == "email":
            widgets.append(RecentErrorsWidget())
        super().__init__(path=path, dashboard=Dashboard(widgets=widgets), **kwargs)

    def is_visible(self, request) -> bool:
        return _superuser(request)


class SystemLink(UserMenuLink):
    """The link to ``SystemPage`` in the user menu, for superusers only."""

    def __init__(self, url: str = "/system/", **kwargs):
        kwargs.setdefault("label", "System")
        kwargs.setdefault("icon", "ph-bold ph-heartbeat")
        super().__init__(url=url, **kwargs)

    def is_visible(self, request) -> bool:
        return _superuser(request)
