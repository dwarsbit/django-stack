"""
The serializer of the generated routes: Django Headless's
``FlexibleSerializer`` with media and blocks ready for a frontend.

- A media library item, expanded with ``?expand=cover`` or anywhere in a
  block field, is serialized as ``{id, type, name, alt, url, width, height,
  focal_point, sizes}``, with absolute URLs and every image size.
- A Content Studio ``BlockField`` is serialized as a list of
  ``{id, type, value}``, with related media items as objects and blocks
  inside blocks resolved the same way.
"""

from __future__ import annotations

from typing import Any

from django.db import models
from django.utils.module_loading import import_string
from headless.rest.serializers import FlexibleSerializer


def get_media_model():
    """The media library model Content Studio uses, or None."""
    try:
        from content_studio.settings import cs_settings
    except ImportError:  # pragma: no cover - Content Studio is not installed
        return None
    path = cs_settings.MEDIA_LIBRARY_MODEL
    if not path:
        return None
    if isinstance(path, str):
        return import_string(path)
    return path


def is_media_model(model) -> bool:
    media_model = get_media_model()
    return media_model is not None and issubclass(model, media_model)


def serialize_media(item, request=None) -> dict[str, Any] | None:
    """A media library item as the frontend needs it."""
    if item is None:
        return None

    def absolute(url: str | None) -> str | None:
        if url and request is not None and url.startswith("/"):
            return request.build_absolute_uri(url)
        return url

    try:
        from content_studio.media_library.sizes import get_image_sizes

        sizes = get_image_sizes(item)
    except Exception:  # noqa: BLE001 - sizes are optional; the file is enough
        sizes = {}

    metadata = getattr(item, "metadata", None) or {}
    properties = getattr(item, "properties", None) or {}
    file = getattr(item, "file", None)

    return {
        "id": str(item.pk),
        "type": getattr(item, "type", "file"),
        "name": getattr(item, "name", ""),
        "alt": getattr(item, "alt_text", ""),
        "url": absolute(file.url) if file else None,
        "width": metadata.get("width"),
        "height": metadata.get("height"),
        "focal_point": properties.get("focal_point"),
        "sizes": {
            name: {"url": absolute(size["url"]), "width": size.get("width"), "height": size.get("height")}
            for name, size in sizes.items()
        },
    }


def serialize_value(value, request=None):
    """A block's field value as JSON."""
    try:
        from content_studio.blocks import BlockList
    except ImportError:  # pragma: no cover
        BlockList = ()  # noqa: N806

    if isinstance(value, BlockList):
        return serialize_blocks(value, request)
    if isinstance(value, models.Model):
        if is_media_model(type(value)):
            return serialize_media(value, request)
        related = {"id": value.pk, "label": str(value)}
        get_url = getattr(value, "get_absolute_url", None)
        if callable(get_url):
            related["url"] = get_url()
        return related
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [serialize_value(item, request) for item in value]
    if isinstance(value, dict):
        return {key: serialize_value(item, request) for key, item in value.items()}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def serialize_blocks(block_list, request=None) -> list[dict]:
    return [
        {
            "id": block.id,
            "type": block.type,
            "value": {name: serialize_value(item, request) for name, item in block.value.items()},
        }
        for block in block_list.blocks
    ]


def block_fields(model) -> list[str]:
    try:
        from content_studio.blocks import BlockField
    except ImportError:  # pragma: no cover
        return []
    return [field.name for field in model._meta.concrete_fields if isinstance(field, BlockField)]


class StackSerializer(FlexibleSerializer):
    def to_representation(self, instance):
        request = self.context.get("request")
        if is_media_model(type(instance)):
            return serialize_media(instance, request)

        data = super().to_representation(instance)
        for name in block_fields(type(instance)):
            if name in data:
                data[name] = serialize_blocks(getattr(instance, name), request)
        return data
