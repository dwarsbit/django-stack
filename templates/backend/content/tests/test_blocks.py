"""Links in blocks: editors can't save a link that runs script."""

import pytest
from content_studio.blocks import BlockErrors

from content.blocks import CallToActionBlock
from content.models import LinkBlock

CTA = {"title": "Join", "text": "", "button_label": "Go"}


@pytest.mark.parametrize("url", ["/contact", "https://example.com", "mailto:hi@example.com", "#top"])
def test_links_keep_paths_and_web_urls(url):
    assert CallToActionBlock.clean({**CTA, "button_url": url})["button_url"] == url
    assert LinkBlock.clean({"label": "Home", "url": url})["url"] == url


@pytest.mark.parametrize("url", ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x"])
def test_links_refuse_script(url):
    with pytest.raises(BlockErrors):
        CallToActionBlock.clean({**CTA, "button_url": url})
    with pytest.raises(BlockErrors):
        LinkBlock.clean({"label": "Home", "url": url})
