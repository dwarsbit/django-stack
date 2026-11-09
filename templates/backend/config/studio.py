"""
The Content Studio site of {{project_name}}: the admin at /admin/.
CONTENT_STUDIO["ADMIN_SITE"] points here. See
https://djangocontentstudio.org/docs/extensions for the hooks and extensions.
"""

from content_studio.admin import ContentStudioSite
from content_studio.analytics import (
    AnalyticsExtension,
    AnalyticsLink,
    AnalyticsPage,
    AnalyticsStatisticWidget,
    AnalyticsTopPagesWidget,
)
from content_studio.dashboard import Dashboard
from content_studio.dashboard.activity_log import ActivityLogWidget
from content_studio.dashboard.tasks import TaskDashboard
from content_studio.extensions import UserMenuLink
from django_stack.analytics import UmamiProvider
from django_stack.studio import HueyAdapter, SystemLink, SystemPage

from content.dashboard import PublishedCountWidget, RecentSubmissionsWidget, SubmissionCountWidget
from content.models import Page, Post

TASKS = HueyAdapter()


class SiteStudio(ContentStudioSite):
    extensions = [
        TaskDashboard(adapter=TASKS),
        UserMenuLink(url="/tasks/", label="Tasks", icon="ph-bold ph-queue"),
        # Superusers only: the health checks and the latest error reports.
        SystemPage(),
        SystemLink(),
    ]

    # Page analytics from the bundled Umami when UMAMI_URL is set (see
    # .env): an Analytics page in the main menu. content/admin.py shows the
    # numbers of each page and post. See
    # https://djangocontentstudio.org/docs/analytics.
    if UmamiProvider.is_configured():
        extensions += [AnalyticsExtension(provider=UmamiProvider()), AnalyticsPage(), AnalyticsLink()]

    # The dashboard at /admin/: what the site has, what came in and what
    # changed; the worker's tasks are on the Tasks page. The counters and
    # the form submissions are in content/dashboard.py; change or remove
    # them there.
    dashboard = Dashboard(
        widgets=[
            PublishedCountWidget(Page, "Published pages", icon="ph-bold ph-file-text"),
            PublishedCountWidget(Post, "Published posts", icon="ph-bold ph-article"),
            SubmissionCountWidget(),
            # Visitors and the most visited pages, with analytics on.
            *([AnalyticsStatisticWidget("visitors", "30d")] if UmamiProvider.is_configured() else []),
            RecentSubmissionsWidget(),
            ActivityLogWidget(),
            *([AnalyticsTopPagesWidget("30d")] if UmamiProvider.is_configured() else []),
        ]
    )


admin_site = SiteStudio()
