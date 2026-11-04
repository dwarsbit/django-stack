from __future__ import annotations

from ... import conf
from .tasks import enqueue_revalidate


def on_content_changed(sender, changes, **kwargs):
    """Content Studio's content_changed signal: forward the changes to the frontend."""
    if not conf.get("REVALIDATE_URL") or not conf.get("REVALIDATE_SECRET"):
        return
    payload = [
        {
            "action": change.action,
            "model": change.model._meta.label_lower if change.model is not None else None,
            "id": str(change.object_id) if change.object_id is not None else None,
        }
        for change in changes
    ]
    if payload:
        enqueue_revalidate(payload)
