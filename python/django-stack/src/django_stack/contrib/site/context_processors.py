from ... import conf
from .preview import in_preview


def site(request):
    """``preview``: drafts are shown; ``analytics_website_id``: Umami's tracker is on."""
    return {
        "preview": in_preview(request),
        "analytics_website_id": (conf.get("UMAMI_WEBSITE_ID") or "") if conf.get("UMAMI_URL") else "",
    }
