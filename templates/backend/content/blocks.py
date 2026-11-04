"""
The blocks editors build page and post bodies from. Add a block here, add
it to a BlockField's ``blocks`` and render it in the frontend's block
registry (``frontend/src/components/blocks``). Blocks need no migration.
"""

from content_studio.blocks import Block
from content_studio.fields import HTMLField
from content_studio.media_library.fields import MediaField
from django.db import models


class TextBlock(Block):
    body = HTMLField()

    class Meta:
        description = "Rich text with headings, lists and links"
        icon = "ph-bold ph-text-t"


class ImageBlock(Block):
    image = MediaField(file_type="image", blank=False)
    caption = models.CharField(max_length=300, blank=True)

    class Meta:
        description = "An image from the media library"
        icon = "ph-bold ph-image"


class QuoteBlock(Block):
    text = models.TextField()
    attribution = models.CharField(max_length=200, blank=True)

    class Meta:
        description = "A quotation"
        icon = "ph-bold ph-quotes"


class CallToActionBlock(Block):
    title = models.CharField(max_length=200)
    text = models.TextField(blank=True)
    button_label = models.CharField(max_length=60)
    button_url = models.CharField(max_length=500, help_text="A path on the site, such as /contact, or a full URL.")

    class Meta:
        name = "call_to_action"
        description = "A highlighted message with a button"
        icon = "ph-bold ph-megaphone"


BODY_BLOCKS = [TextBlock, ImageBlock, QuoteBlock, CallToActionBlock]
