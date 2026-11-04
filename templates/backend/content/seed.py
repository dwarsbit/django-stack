"""
Demo content for a new site: `manage.py seed_content` runs ``seed``.
Change it to fit your site, or delete the demo content in the admin.
"""

import io
import uuid

from content_studio.media_library.models import Media
from django.core.files.base import ContentFile
from django.db import transaction

from .models import Author, Category, Menu, Page, Post, Redirect, SiteSettings, Tag


def block(type: str, **data) -> dict:
    return {"id": str(uuid.uuid4()), "type": type, "data": data}


def text(html: str) -> dict:
    return block("text", body=html)


def image_block(media: Media, caption: str = "") -> dict:
    return block("image", image=str(media.pk), caption=caption)


def make_image(name: str, hue: int, width: int = 1600, height: int = 900) -> Media:
    """A generated gradient image, so the demo needs no downloads."""
    from PIL import Image, ImageOps

    gradient = Image.linear_gradient("L").rotate(30 * hue, expand=True).resize((width, height))
    colors = [("#0c4b33", "#44b78b"), ("#1e3a8a", "#60a5fa"), ("#7c2d12", "#fb923c"), ("#4c1d95", "#c084fc")]
    dark, light = colors[hue % len(colors)]
    image = ImageOps.colorize(gradient, black=dark, white=light)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    media = Media(name=name, alt_text=name, type="image", metadata={"width": width, "height": height})
    media.file.save(f"{name.lower().replace(' ', '-')}.jpg", ContentFile(buffer.getvalue()), save=False)
    media.save()
    return media


@transaction.atomic
def seed(if_empty: bool = False, stdout=None) -> bool:
    if if_empty and (Page.objects.exists() or Post.objects.exists()):
        return False

    hero = make_image("Hero image", 0)
    covers = [make_image(f"Cover {number}", number) for number in range(1, 4)]

    home = Page.objects.create(
        title="Welcome",
        slug="home",
        status="published",
        seo_description="A new site built with DjangoStack.",
        body=[
            text(
                "<h2>Your site is running</h2>"
                '<p>This page comes from Django: edit it in the admin at <a href="/admin/">/admin/</a>, '
                "publish, and the site shows the change.</p>"
            ),
            image_block(hero, "Images come from the media library, in every size the site needs."),
            block(
                "call_to_action",
                title="Read the blog",
                text="Three demo posts show categories, tags, authors and cover images.",
                button_label="Go to the blog",
                button_url="/blog",
            ),
        ],
    )
    about = Page.objects.create(
        title="About",
        slug="about",
        status="published",
        body=[
            text("<p>An about page. Pages can have child pages, such as the team page below.</p>"),
            block("quote", text="Content first, code second.", attribution="An editor"),
        ],
    )
    Page.objects.create(
        title="Team",
        slug="team",
        parent=about,
        status="published",
        body=[text("<p>A child page at <code>/about/team</code>.</p>")],
    )
    contact = Page.objects.create(
        title="Contact",
        slug="contact",
        status="published",
        body=[text("<p>Send a message with the form below. Submissions appear in the admin.</p>")],
    )
    Page.objects.create(
        title="Draft page",
        slug="draft",
        body=[text("<p>Only visible with a preview link from the admin.</p>")],
    )

    author = Author.objects.create(name="Ada Editor", slug="ada", bio="Writes the demo posts.")
    news = Category.objects.create(name="News", slug="news")
    guides = Category.objects.create(name="Guides", slug="guides")
    django_tag = Tag.objects.create(name="Django", slug="django")
    astro_tag = Tag.objects.create(name="Astro", slug="astro")

    posts = [
        ("Hello, world", "hello-world", news, [django_tag], "The first post of the new site."),
        ("Editing content", "editing-content", guides, [django_tag], "How pages and posts are edited."),
        ("Rendering with Astro", "rendering-with-astro", guides, [astro_tag], "How the frontend shows content."),
    ]
    for (title, slug, category, tags, excerpt), cover in zip(posts, covers, strict=True):
        post = Post.objects.create(
            title=title,
            slug=slug,
            excerpt=excerpt,
            cover=cover,
            author=author,
            status="published",
            body=[
                text(f"<p>{excerpt}</p><h2>A heading</h2><p>Body text with <strong>bold</strong> words.</p>"),
                text("<ul><li>A list item</li><li>Another one</li></ul>"),
            ],
        )
        post.categories.add(category)
        post.tags.set(tags)

    Menu.objects.create(
        name="Main",
        slug="main",
        items=[
            block("link", label="Home", url="/"),
            block("link", label="Blog", url="/blog"),
            block("link", label="About", page=about.pk),
            block("link", label="Contact", page=contact.pk),
        ],
    )
    Menu.objects.create(
        name="Footer",
        slug="footer",
        items=[block("link", label="RSS", url="/rss.xml")],
    )
    Redirect.objects.create(old_path="/old-about", new_path="/about")

    settings = SiteSettings.objects.first() or SiteSettings()
    settings.site_name = "{{project_name}}"
    settings.tagline = "Built with DjangoStack"
    settings.home_page = home
    settings.seo_description = "A website built with Django, Django Headless, Content Studio and Astro."
    settings.share_image = hero
    settings.footer_text = "<p>Powered by DjangoStack.</p>"
    settings.save()
    return True
