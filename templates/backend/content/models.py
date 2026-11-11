"""
The content model of {{project_name}}: pages, posts and their taxonomies,
site settings, menus, redirects and form submissions.

These models are yours: add fields, remove models, create new ones. Every
model exposed with ``@expose()`` gets routes under /api/ (see
https://djangoheadless.org/docs/models); register it in ``admin.py`` to edit
it in Content Studio. After a change, run ``{{pm_run}} backend makemigrations``
and ``{{pm_run}} generate:types``.
"""

from content_studio.blocks import Block, BlockField
from content_studio.fields import HTMLField
from content_studio.media_library.fields import MediaField
from content_studio.media_library.models import Media
from django.core.exceptions import ValidationError
from django.db import models
from django_stack.models import PublishableModel
from django_stack.validators import validate_link
from headless import expose, expose_model

from .blocks import BODY_BLOCKS


class SeoFields(models.Model):
    """Search engine and social sharing fields; empty fields fall back to the site settings."""

    seo_title = models.CharField("SEO title", max_length=70, blank=True)
    seo_description = models.CharField("SEO description", max_length=160, blank=True)
    share_image = MediaField(file_type="image", help_text="Shown when the page is shared; 1200 × 630 works best.")

    class Meta:
        abstract = True


@expose(read_only=True, lookup_fields=["slug"])
class Category(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)

    class Meta:
        verbose_name_plural = "categories"
        ordering = ["name"]

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return f"/category/{self.slug}"


@expose(read_only=True, lookup_fields=["slug"])
class Tag(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def get_absolute_url(self):
        return f"/tag/{self.slug}"


@expose(read_only=True, lookup_fields=["slug"])
class Author(models.Model):
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    bio = models.TextField(blank=True)
    avatar = MediaField(file_type="image")

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


@expose(read_only=True)
class Page(PublishableModel, SeoFields):
    """A page of the site at /<path>, such as /about or /about/team."""

    title = models.CharField(max_length=200)
    slug = models.SlugField()
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    path = models.CharField(max_length=500, unique=True, editable=False)
    body = BlockField(blocks=BODY_BLOCKS, blank=True, default=list, max_num=50)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "title"]
        constraints = [models.UniqueConstraint(fields=["parent", "slug"], name="unique_page_slug_per_parent")]

    def __str__(self):
        return self.title

    def save(self, *args, **kwargs):
        old_path = self.path
        self.path = self.build_path()
        super().save(*args, **kwargs)
        if old_path and old_path != self.path:
            for child in self.children.all():
                child.save()

    def get_absolute_url(self):
        return f"/{self.path}"

    def build_path(self) -> str:
        return f"{self.parent.path}/{self.slug}" if self.parent else self.slug

    def clean(self):
        ancestor = self.parent
        while ancestor is not None:
            if ancestor.pk == self.pk:
                raise ValidationError({"parent": "A page cannot be its own parent or ancestor."})
            ancestor = ancestor.parent


@expose(read_only=True, lookup_fields=["slug"])
class Post(PublishableModel, SeoFields):
    """A blog post at /blog/<slug>."""

    title = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    excerpt = models.TextField(blank=True, help_text="A short summary for lists and search results.")
    cover = MediaField(file_type="image")
    body = BlockField(blocks=BODY_BLOCKS, blank=True, default=list, max_num=50)
    author = models.ForeignKey(Author, null=True, blank=True, on_delete=models.SET_NULL, related_name="posts")
    categories = models.ManyToManyField(Category, blank=True, related_name="posts")
    tags = models.ManyToManyField(Tag, blank=True, related_name="posts")

    class Meta:
        ordering = ["-published_at", "-pk"]

    def __str__(self):
        return self.title

    def get_absolute_url(self):
        return f"/blog/{self.slug}"


class LinkBlock(Block):
    label = models.CharField(max_length=100)
    page = models.ForeignKey(Page, null=True, blank=True, on_delete=models.SET_NULL)
    url = models.CharField(
        max_length=500, blank=True, help_text="Used when no page is chosen.", validators=[validate_link]
    )

    class Meta:
        name = "link"
        description = "A link to a page or a URL"
        icon = "ph-bold ph-link"


@expose(read_only=True, lookup_fields=["slug"])
class Menu(models.Model):
    """A navigation menu, such as "main" in the header or "footer"."""

    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True, help_text="The frontend asks for a menu by this name, such as main.")
    items = BlockField(blocks=[LinkBlock], blank=True, default=list, max_num=20)

    def __str__(self):
        return self.name


@expose(singleton=True, read_only=True)
class SiteSettings(models.Model):
    site_name = models.CharField(max_length=100, default="{{project_name}}")
    tagline = models.CharField(max_length=200, blank=True)
    logo = MediaField(file_type="image")
    home_page = models.ForeignKey(
        Page,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
        help_text="The page shown at /. Without one, the home page lists the latest posts.",
    )
    seo_description = models.CharField("default SEO description", max_length=160, blank=True)
    share_image = MediaField(file_type="image", help_text="The default image for social sharing.")
    social_links = models.JSONField(default=dict, blank=True, help_text='Such as {"Mastodon": "https://..."}.')
    footer_text = HTMLField(blank=True)

    class Meta:
        verbose_name = "site settings"
        verbose_name_plural = "site settings"

    def __str__(self):
        return self.site_name


@expose(read_only=True)
class Redirect(models.Model):
    """A redirect the frontend applies before showing its not found page."""

    old_path = models.CharField(max_length=500, unique=True, help_text="Such as /old-page, without the domain.")
    new_path = models.CharField(max_length=500, help_text="A path on the site or a full URL.")
    permanent = models.BooleanField(default=True, help_text="301 when on, 302 when off.")

    class Meta:
        ordering = ["old_path"]

    def __str__(self):
        return f"{self.old_path} → {self.new_path}"

    def save(self, *args, **kwargs):
        self.old_path = "/" + self.old_path.strip().strip("/")
        super().save(*args, **kwargs)


@expose(fields=["id", "name", "email", "message", "created_at"])
class FormSubmission(models.Model):
    """A contact form submission. Anyone may create one (PUBLIC_CREATE); only editors read them."""

    name = models.CharField(max_length=200)
    email = models.EmailField()
    message = models.TextField(max_length=5000)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} <{self.email}>"


# The media library, read-only: `?expand=cover` and blocks return media items
# with their URL and image sizes.
expose_model(
    Media,
    read_only=True,
    fields=["id", "name", "alt_text", "type", "file", "metadata", "properties"],
)
