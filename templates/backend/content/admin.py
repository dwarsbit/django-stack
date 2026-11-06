"""
The studios of the content models: how they look in Content Studio at
/admin/. See https://djangocontentstudio.org/docs/registering-models.
"""

from content_studio import register
from content_studio.admin import ModelStudio
from content_studio.analytics import Analytics
from content_studio.form import ActivityLog, Field, FormSet
from django_stack.studio import PreviewButton

from .models import Author, Category, FormSubmission, Menu, Page, Post, Redirect, SiteSettings, Tag

# Components on more than one studio need their own component_id.
PAGE_PREVIEW = PreviewButton(component_id="8d0f6a52-3c51-4a8e-9a2b-6f1f0c8f2a01")
POST_PREVIEW = PreviewButton(component_id="8d0f6a52-3c51-4a8e-9a2b-6f1f0c8f2a02")
PAGE_ACTIVITY = ActivityLog(component_id="8d0f6a52-3c51-4a8e-9a2b-6f1f0c8f2a03")
POST_ACTIVITY = ActivityLog(component_id="8d0f6a52-3c51-4a8e-9a2b-6f1f0c8f2a04")
# The visitors of the page or post, from the analytics (see config/studio.py).
# Hidden while analytics are off.
PAGE_ANALYTICS = Analytics(path_field="path", component_id="8d0f6a52-3c51-4a8e-9a2b-6f1f0c8f2a05")
POST_ANALYTICS = Analytics(path_field="slug", path_prefix="/blog/", component_id="8d0f6a52-3c51-4a8e-9a2b-6f1f0c8f2a06")
SEO = FormSet(
    title="Search and sharing",
    description="Leave empty to use the title and the site settings.",
    fields=["seo_title", "seo_description", "share_image"],
)


@register(Page)
class PageStudio(ModelStudio):
    icon = "ph-bold ph-file-text"
    table_display = ["title", "path", "status", "published_at"]
    list_filter = ["status"]
    search_fields = ["title", "path"]
    ordering = ["path"]
    prepopulated_fields = {"slug": ["title"]}
    allow_duplication = True
    edit_width = "wide"
    edit_main = [
        FormSet(title="Page", fields=["title", Field("slug", col_span=1), Field("parent", col_span=1)]),
        FormSet(title="Body", fields=["body"]),
        SEO,
    ]
    edit_sidebar = ["status", "published_at", PAGE_PREVIEW, "order", PAGE_ANALYTICS, PAGE_ACTIVITY]


@register(Post)
class PostStudio(ModelStudio):
    icon = "ph-bold ph-article"
    table_display = ["title", "author", "status", "published_at"]
    list_filter = ["status", "categories", "tags", "author"]
    search_fields = ["title", "excerpt"]
    ordering = ["-published_at"]
    prepopulated_fields = {"slug": ["title"]}
    allow_duplication = True
    edit_width = "wide"
    edit_main = [
        FormSet(title="Post", fields=["title", "slug", "cover", "excerpt"]),
        FormSet(title="Body", fields=["body"]),
        SEO,
    ]
    edit_sidebar = [
        "status",
        "published_at",
        POST_PREVIEW,
        "author",
        "categories",
        "tags",
        POST_ANALYTICS,
        POST_ACTIVITY,
    ]


@register(Category, Tag)
class TaxonomyStudio(ModelStudio):
    icon = "ph-bold ph-tag"
    table_display = ["name", "slug"]
    search_fields = ["name"]
    prepopulated_fields = {"slug": ["name"]}


@register(Author)
class AuthorStudio(ModelStudio):
    icon = "ph-bold ph-user-circle"
    table_display = ["name", "slug"]
    search_fields = ["name"]
    prepopulated_fields = {"slug": ["name"]}


@register(Menu)
class MenuStudio(ModelStudio):
    icon = "ph-bold ph-list"
    table_display = ["name", "slug"]
    prepopulated_fields = {"slug": ["name"]}


@register(SiteSettings)
class SiteSettingsStudio(ModelStudio):
    icon = "ph-bold ph-gear"
    is_singleton = True
    edit_main = [
        FormSet(title="Site", fields=["site_name", "tagline", "logo", "home_page"]),
        FormSet(title="Search and sharing", fields=["seo_description", "share_image"]),
        FormSet(title="Footer", fields=["footer_text", "social_links"]),
    ]


@register(Redirect)
class RedirectStudio(ModelStudio):
    icon = "ph-bold ph-arrow-bend-up-right"
    table_display = ["old_path", "new_path", "permanent"]
    search_fields = ["old_path", "new_path"]


@register(FormSubmission)
class FormSubmissionStudio(ModelStudio):
    icon = "ph-bold ph-envelope"
    table_display = ["name", "email", "created_at"]
    search_fields = ["name", "email", "message"]
    ordering = ["-created_at"]
