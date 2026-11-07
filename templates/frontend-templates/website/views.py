"""
The pages of the site, rendered by Django. They read the content through
the ORM with ``published()``, which hides drafts and scheduled posts
unless an editor opened a preview, the same rules as the content API.

``@site_page`` caches each page until content changes (in Django's cache,
the database by default) and sets the Content-Security-Policy.
"""

from django.conf import settings
from django.core.paginator import Paginator
from django.http import Http404, HttpResponseNotAllowed
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_safe
from django_stack.contrib.site import published, site_page
from rest_framework.throttling import SimpleRateThrottle

from content.models import Category, Page, Post, SiteSettings, Tag

from .forms import ContactForm

POSTS_PER_PAGE = 9


def posts(request):
    return published(Post.objects.select_related("author").prefetch_related("categories", "tags"), request)


def post_list(request, queryset):
    """One page of posts, from the ?page= parameter."""
    number = request.GET.get("page", "1")
    return Paginator(queryset, POSTS_PER_PAGE).get_page(number if number.isdigit() else 1)


@site_page
@require_safe
def home(request):
    site = SiteSettings.objects.first()
    home_page = site.home_page if site else None
    if home_page and not published(Page.objects.filter(pk=home_page.pk), request).exists():
        home_page = None
    if home_page:
        return render(request, "website/page.html", {"page": home_page})
    return render(request, "website/home.html", {"posts": post_list(request, posts(request))})


@site_page
@require_safe
def blog(request):
    return render(
        request,
        "website/post_list.html",
        {"title": "Blog", "seo_page": {"title": "Blog"}, "posts": post_list(request, posts(request))},
    )


@site_page
@require_safe
def post(request, slug):
    item = get_object_or_404(posts(request), slug=slug)
    return render(request, "website/post.html", {"post": item})


@site_page
@require_safe
def category(request, slug):
    item = get_object_or_404(Category, slug=slug)
    return render(
        request,
        "website/post_list.html",
        {
            "title": item.name,
            "seo_page": {"title": item.name, "seo_description": item.description},
            "label": "Category",
            "description": item.description,
            "posts": post_list(request, posts(request).filter(categories=item)),
        },
    )


@site_page
@require_safe
def tag(request, slug):
    item = get_object_or_404(Tag, slug=slug)
    return render(
        request,
        "website/post_list.html",
        {
            "title": f"#{item.name}",
            "seo_page": {"title": item.name},
            "label": "Tag",
            "posts": post_list(request, posts(request).filter(tags=item)),
        },
    )


@site_page
def page(request, path):
    item = published(Page.objects.all(), request).filter(path=path.strip("/")).first()
    if item is None:
        raise Http404
    if item.path == "contact":
        return contact(request, item)
    if request.method not in ("GET", "HEAD"):
        return HttpResponseNotAllowed(["GET", "HEAD"])
    return render(request, "website/page.html", {"page": item})


class ContactThrottle(SimpleRateThrottle):
    """The API's limit for public forms, per IP address: PUBLIC_WRITE_THROTTLE_RATE (10/minute)."""

    scope = "public_write"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


@site_page(cache_page=False, captcha=True)
def contact(request, item):
    """The contact page: its blocks and the form, which posts to itself."""
    form = ContactForm(request.POST or None)
    sent = request.GET.get("sent") == "1"
    status = 200
    if request.method == "POST":
        throttle = ContactThrottle()
        if not throttle.allow_request(request, None):
            form.add_error(None, "Too many messages; try again in a minute.")
            status = 429
        elif form.is_valid():
            form.save()
            # Post/redirect/get: a reload does not send the message again.
            return redirect(f"{request.path}?sent=1")
        else:
            status = 400
    return render(request, "website/page.html", {"page": item, "form": form, "sent": sent}, status=status)


@site_page
@require_safe
def rss(request):
    site = SiteSettings.objects.first()
    return render(
        request,
        "website/rss.xml",
        {"site": site, "site_url": settings.SITE_URL, "posts": posts(request).order_by("-published_at")[:20]},
        content_type="application/rss+xml; charset=utf-8",
    )


@site_page
@require_safe
def sitemap(request):
    site = SiteSettings.objects.first()
    pages = published(Page.objects.all(), request)
    if site and site.home_page_id:
        pages = pages.exclude(pk=site.home_page_id)
    return render(
        request,
        "website/sitemap.xml",
        {"site_url": settings.SITE_URL, "pages": pages, "posts": posts(request)},
        content_type="application/xml; charset=utf-8",
    )


@site_page
@require_safe
def robots(request):
    return render(
        request, "website/robots.txt", {"site_url": settings.SITE_URL}, content_type="text/plain; charset=utf-8"
    )


@site_page(cache_page=False)
def not_found(request, exception=None):
    """The 404 page, with the site's layout (handler404 in config/urls.py)."""
    return render(request, "website/404.html", {"not_found": {"title": "Page not found"}}, status=404)
