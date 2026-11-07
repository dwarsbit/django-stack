"""
Template tags of a site Django renders: ``{% load stack %}``.

- ``{% blocks page.body %}`` renders each block of a block field with the
  template ``site/blocks/<type>.html`` (``SITE_BLOCK_TEMPLATE``), which
  gets ``block`` and its ``value``. Types without a template render nothing.
- ``{% image media size="card" sizes="100vw" %}`` renders an ``<img>`` of a
  media library item with a ``srcset`` of its image sizes.
- ``{% seo page site type="article" %}`` renders the title, description,
  canonical URL, Open Graph and Twitter tags; empty fields fall back to the
  site settings.
- ``{{ item|link_href }}``: the URL of a menu link; ``{{ href|is_current:request.path }}``.
"""

from __future__ import annotations

from django import template
from django.conf import settings
from django.template.loader import get_template
from django.utils.html import format_html, format_html_join
from django.utils.safestring import mark_safe

from django_stack import conf
from django_stack.rest.serializers import serialize_media

register = template.Library()


def _media(media, request=None) -> dict | None:
    if isinstance(media, dict):
        return media if "url" in media and "sizes" in media else None
    if media is None or isinstance(media, (str, int)):
        return None
    return serialize_media(media, request)


def image_url(media, size: str | None = None, request=None) -> str | None:
    item = _media(media, request)
    if not item:
        return None
    chosen = item["sizes"].get(size) if size else None
    return (chosen or {}).get("url") or item["url"]


def image_attributes(media, *, size=None, alt=None, request=None) -> dict | None:
    """The attributes of an ``<img>``, as ``imageAttributes`` of @django-stack/utils builds them."""
    item = _media(media, request)
    if not item or not item.get("url"):
        return None
    chosen = item["sizes"].get(size) if size else None
    candidates = sorted(
        (value for value in item["sizes"].values() if value.get("width")), key=lambda value: value["width"]
    )
    unique, widths = [], set()
    for candidate in candidates:
        if candidate["width"] not in widths:
            widths.add(candidate["width"])
            unique.append(candidate)
    attributes = {
        "src": (chosen or {}).get("url") or item["url"],
        "alt": alt if alt is not None else (item.get("alt") or ""),
        "width": (chosen or {}).get("width") or item.get("width"),
        "height": (chosen or {}).get("height") or item.get("height"),
        "srcset": ", ".join(f"{value['url']} {value['width']}w" for value in unique) or None,
    }
    focal_point = item.get("focal_point")
    if focal_point:
        attributes["style"] = f"object-position: {focal_point['x']}% {focal_point['y']}%"
    return attributes


@register.simple_tag(takes_context=True)
def image(context, media, size=None, sizes="100vw", alt=None, eager=False, class_name=""):
    attributes = image_attributes(media, size=size, alt=alt, request=context.get("request"))
    if attributes is None:
        return ""
    if attributes["srcset"]:
        attributes["sizes"] = sizes
    if class_name:
        attributes["class"] = class_name
    attributes["loading"] = "eager" if eager else "lazy"
    attributes["decoding"] = "async"
    shown = [(name, value) for name, value in attributes.items() if value not in (None, "") or name == "alt"]
    return format_html("<img{}>", format_html_join("", ' {}="{}"', shown))


@register.simple_tag(takes_context=True)
def blocks(context, value):
    items = getattr(value, "blocks", value) or []
    pattern = conf.get("SITE_BLOCK_TEMPLATE")
    request = context.get("request")
    rendered = []
    for block in items:
        block_type = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)
        block_value = block.get("value") if isinstance(block, dict) else getattr(block, "value", None)
        try:
            block_template = get_template(pattern.format(type=block_type))
        except template.TemplateDoesNotExist:
            continue
        with context.push(block=block, value=block_value):
            rendered.append(block_template.render(context.flatten(), request))
    return mark_safe("".join(rendered))  # noqa: S308 - rendered by the project's templates


def _value(obj, name):
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


@register.inclusion_tag("django_stack/site/seo.html", takes_context=True)
def seo(context, page=None, site=None, type="website"):  # noqa: A002 - the Open Graph name
    request = context.get("request")
    site_name = _value(site, "site_name") or ""
    page_title = _value(page, "seo_title") or _value(page, "title") or ""
    if page_title and site_name and page_title != site_name:
        title = f"{page_title} | {site_name}"
    else:
        title = page_title or site_name
    description = (
        _value(page, "seo_description") or _value(page, "excerpt") or _value(site, "seo_description") or ""
    )
    site_url = getattr(settings, "SITE_URL", "").rstrip("/")
    canonical = f"{site_url}{request.path if request is not None else '/'}"
    share_image = (
        image_url(_value(page, "share_image"), "share", request)
        or image_url(_value(page, "cover"), "share", request)
        or image_url(_value(site, "share_image"), "share", request)
    )
    open_graph = {"og:title": page_title or site_name, "og:type": type, "og:url": canonical}
    if site_name:
        open_graph["og:site_name"] = site_name
    if description:
        open_graph["og:description"] = description
    if share_image:
        open_graph["og:image"] = share_image
    twitter = {"twitter:card": "summary_large_image" if share_image else "summary"}
    return {
        "title": title,
        "description": description,
        "canonical": canonical,
        "open_graph": open_graph.items(),
        "twitter": twitter.items(),
    }


@register.filter
def link_href(item) -> str:
    """The URL of a menu link block: its page's URL, or its own URL."""
    value = _value(item, "value") or {}
    page = _value(value, "page")
    if page is not None:
        get_url = getattr(page, "get_absolute_url", None)
        url = get_url() if callable(get_url) else _value(page, "url")
        if url:
            return url
    return _value(value, "url") or "/"


@register.filter
def is_current(href, path) -> bool:
    """Whether the link ``href`` is the page at ``path`` or one of its parents (not ``/``)."""
    if not href or not path:
        return False
    href = str(href)
    return href == path or (href != "/" and str(path).startswith(f"{href.rstrip('/')}/"))
