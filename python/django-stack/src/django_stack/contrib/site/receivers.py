"""Empty the page cache when content changes: a save, a delete or a change in the admin."""

from __future__ import annotations

from django.db.models.signals import m2m_changed, post_delete, post_save

from ... import conf
from .cache import clear_site_cache


def is_content(sender) -> bool:
    """A model of the CONTENT_APPS, or the media library, whose changes the site shows."""
    from ...rest.serializers import is_media_model

    meta = getattr(sender, "_meta", None)
    if meta is None:
        return False
    if meta.app_label in conf.get("CONTENT_APPS"):
        return True
    model = meta.auto_created or sender  # the through model of a many-to-many field
    return model._meta.app_label in conf.get("CONTENT_APPS") or is_media_model(model)


def on_model_changed(sender, **kwargs):
    if kwargs.get("raw"):  # loaddata
        return
    if is_content(sender):
        clear_site_cache()


def on_content_changed(sender, **kwargs):
    clear_site_cache()


def connect():
    for name, signal in (("save", post_save), ("delete", post_delete), ("m2m", m2m_changed)):
        signal.connect(on_model_changed, dispatch_uid=f"django_stack_site_{name}")
    try:
        from content_studio.signals import content_changed
    except ImportError:  # pragma: no cover - Content Studio is not installed
        return
    content_changed.connect(on_content_changed, dispatch_uid="django_stack_site_content_changed")
