from content_studio.blocks import Block, BlockField
from content_studio.media_library.fields import MediaField
from django.db import models
from headless import expose

from django_stack.models import PublishableModel


class TextBlock(Block):
    body = models.TextField()


class ImageBlock(Block):
    image = MediaField(blank=False)
    caption = models.CharField(max_length=200, blank=True)


@expose()
class Writer(models.Model):
    name = models.CharField(max_length=50)

    def __str__(self):
        return self.name


@expose(lookup_fields=["slug"])
class Article(PublishableModel):
    writer = models.ForeignKey(
        Writer, null=True, blank=True, on_delete=models.SET_NULL, related_name="articles"
    )
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children"
    )
    title = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    cover = MediaField(null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    body = BlockField(blocks=[TextBlock, ImageBlock], blank=True, default=list)

    def get_absolute_url(self):
        return f"/blog/{self.slug}"


class Redirect(models.Model):
    old_path = models.CharField(max_length=500, unique=True)
    new_path = models.CharField(max_length=500)
    permanent = models.BooleanField(default=True)

    def __str__(self):
        return self.old_path


@expose()
class Message(models.Model):
    email = models.EmailField()
    text = models.TextField()

    def __str__(self):
        return self.email


# The media library, read-only, so ?expand=cover returns the media item.
from content_studio.media_library.models import Media  # noqa: E402
from headless import expose_model  # noqa: E402

expose_model(
    Media, read_only=True, fields=["id", "name", "alt_text", "type", "file", "metadata", "properties"]
)
