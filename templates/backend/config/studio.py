"""
The Content Studio site of {{project_name}}: the admin at /admin/.
CONTENT_STUDIO["ADMIN_SITE"] points here. See
https://djangocontentstudio.org/docs/extensions for the hooks and extensions.
"""

from content_studio.admin import ContentStudioSite
from content_studio.contrib.huey import HueyAdapter
from content_studio.dashboard.tasks import TaskDashboard
from content_studio.extensions import UserMenuLink


class SiteStudio(ContentStudioSite):
    extensions = [
        TaskDashboard(adapter=HueyAdapter()),
        UserMenuLink(url="/tasks/", label="Tasks", icon="ph-bold ph-queue"),
    ]


admin_site = SiteStudio()
