import pytest
from django.core.exceptions import ValidationError

from django_stack.validators import safe_href, validate_link


@pytest.mark.parametrize(
    "url", ["/contact", "#top", "?page=2", "blog", "https://example.com", "mailto:a@example.com", "tel:+31"]
)
def test_safe_links(url):
    validate_link(url)
    assert safe_href(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "JAVASCRIPT:alert(1)",
        " javascript:x",
        "\x01javascript:x",
        "java\tscript:x",
        "data:text/html,x",
    ],
)
def test_unsafe_links(url):
    with pytest.raises(ValidationError):
        validate_link(url)
    assert safe_href(url) == "/"


def test_empty_link_uses_the_fallback():
    assert safe_href("", "#") == "#"
    assert safe_href(None) == "/"
