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
"""

from content_studio.dashboard import Dashboard
from content_studio.dashboard.content_list import ContentListWidget
from content_studio.extensions import DashboardPage, UserMenuLink
from content_studio.form import ButtonLink
from django.apps import apps
from django.utils.translation import gettext_lazy as _

from . import errors, health
from .preview import preview_url


class PreviewButton(ButtonLink):
    label = "Preview"
    icon = "ph-bold ph-eye"

    def get_url(self, obj, request):
        get_path = getattr(obj, "get_absolute_url", None)
        path = get_path() if callable(get_path) else "/"
        return preview_url(path)


def _superuser(request) -> bool:
    user = getattr(request, "user", None)
    return bool(user and user.is_active and user.is_superuser)


# The badge of each check result: its label and color.
STATUS = {
    "ok": (_("OK"), "success"),
    "error": (_("Failing"), "danger"),
    "off": (_("Off"), "default"),
}


class SystemStatusWidget(ContentListWidget):
    """The database, cache, worker and daily backup checks, with when the worker and the backup last ran."""

    name = "DjangoStackSystemStatus"
    refresh_interval = 60

    def get_data(self, request):
        checks = health.status()
        rows = [
            (_("Database"), checks["database"], _("Postgres answers queries."), None),
            (_("Cache"), checks["cache"], _("The cache stores and returns values."), None),
            (
                _("Worker"),
                checks["worker"],
                _("Runs the tasks; checks in every minute. Off when tasks run in the request."),
                health.stamped_at(health.HEARTBEAT_KEY) if checks["worker"] != "off" else None,
            ),
            (
                _("Daily backup"),
                checks["backup"],
                _("Failing when the last backup is more than 26 hours old. Off until the first one."),
                health.stamped_at(health.BACKUP_KEY) if checks["backup"] != "off" else None,
            ),
        ]
        content = []
        for title, result, description, timestamp in rows:
            label, variant = STATUS[result]
            content.append(
                {
                    "title": str(title),
                    "description": str(description),
                    "status": str(label),
                    "status_variant": variant,
                    "timestamp": timestamp,
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
        if apps.is_installed("content_studio.notifications"):
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
