"""
The Content Studio site of {{project_name}}: the admin at /admin/.
CONTENT_STUDIO["ADMIN_SITE"] points here. See
https://djangocontentstudio.org/docs/extensions for the hooks and extensions.
"""

from content_studio.admin import ContentStudioSite
from content_studio.analytics import AnalyticsExtension, AnalyticsLink, AnalyticsPage
from content_studio.contrib.huey import HueyAdapter
from content_studio.dashboard.tasks import TaskDashboard
from content_studio.extensions import UserMenuLink
from django_stack.analytics import UmamiProvider
from django_stack.studio import SystemLink, SystemPage


class SiteStudio(ContentStudioSite):
    extensions = [
        TaskDashboard(adapter=HueyAdapter()),
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


admin_site = SiteStudio()
