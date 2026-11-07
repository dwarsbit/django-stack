"""
A site rendered by Django templates, with what the JavaScript frontends of
DjangoStack do: preview of drafts, a page cache emptied when content
changes, editor-managed redirects, block fields, images and SEO tags.

Add ``"django_stack.contrib.site"`` to ``INSTALLED_APPS``, then:

- ``path("", include("django_stack.contrib.site.urls"))`` serves
  ``/preview?token=…&path=…``, the admin's Preview button, and
  ``/preview/exit``, and Umami's tracker and page views at ``/_a/`` where
  no reverse proxy serves them (development).
- ``@site_page`` on a view caches its page until content changes, skips
  the cache in preview and sets the site's Content-Security-Policy.
- ``published(queryset, request)`` returns what a visitor may see: the
  published objects, or drafts too in preview, as the content API does.
- ``RedirectMiddleware`` answers a 404 with the redirect an editor set
  (``DJANGO_STACK["SITE_REDIRECT_MODEL"]``, ``content.Redirect`` by default).
- ``{% load stack %}`` gives ``{% blocks %}``, ``{% image %}``, ``{% seo %}``
  and the ``link_href`` and ``is_current`` filters.
- The context processor ``django_stack.contrib.site.context_processors.site``
  adds ``preview`` and ``analytics_website_id`` to every template.
"""

from .cache import clear_site_cache, site_page
from .preview import in_preview, published

__all__ = ["clear_site_cache", "in_preview", "published", "site_page"]
