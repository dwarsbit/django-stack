"""
The captcha in a Django form, for sites that Django renders:

    from django_stack.contrib.captcha.forms import CaptchaField

    class ContactForm(forms.Form):
        email = forms.EmailField()
        captcha = CaptchaField()

Render ``{{ form.media }}`` on the page: it loads the ``@cap.js/widget``
web component (vendored, version 0.1.58) and points it at this site's
solver. The page's Content-Security-Policy must allow ``CAPTCHA_CSP``.
"""

from __future__ import annotations

from django import forms
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

from ... import conf
from .tokens import verify_captcha

#: Where the widget talks to ``django_stack.contrib.captcha``.
CAPTCHA_ENDPOINT = "/api/cap/"

#: The hash of the ``<style>`` the widget adds to its shadow root. It changes
#: with the widget's version; a test recomputes it from the vendored file.
CAPTCHA_STYLE_HASH = "'sha256-wztaw4JykxcHsDODFshiqt3woVAWzD4k5Zi3KJI3B5U='"

#: What a Content-Security-Policy must allow for the widget, by directive:
#: its solver (WebAssembly), its style and its workers (blob URLs).
CAPTCHA_CSP: dict[str, tuple[str, ...]] = {
    "script-src": ("'wasm-unsafe-eval'",),
    "style-src": (CAPTCHA_STYLE_HASH,),
    "worker-src": ("'self'", "blob:"),
}


class CaptchaWidget(forms.Widget):
    """The ``<cap-widget>`` element; it adds a hidden input with the token to the form."""

    class Media:
        js = [
            forms.Script("django_stack/captcha/loader.js", defer=True),
            forms.Script("django_stack/captcha/cap.min.js", defer=True),
        ]

    def render(self, name, value, attrs=None, renderer=None):
        if not conf.get("CAPTCHA"):
            return ""
        element_id = (attrs or {}).get("id") or self.attrs.get("id") or f"id_{name}"
        return format_html(
            '<cap-widget id="{}" data-cap-api-endpoint="{}" data-cap-hidden-field-name="{}"></cap-widget>',
            element_id,
            CAPTCHA_ENDPOINT,
            name,
        )

    def use_required_attribute(self, initial):
        return False


class CaptchaField(forms.CharField):
    """A form field for the widget's token. A token is valid once; ``CAPTCHA=off`` skips the check."""

    widget = CaptchaWidget
    default_error_messages = {
        "required": _("Verify that you are human."),
        "invalid": _("The captcha is not valid or has expired. Verify that you are human and try again."),
    }

    def __init__(self, **kwargs):
        kwargs.setdefault("max_length", 100)
        kwargs.setdefault("label", _("Captcha"))
        super().__init__(**kwargs)

    def clean(self, value):
        if not conf.get("CAPTCHA"):
            return ""
        token = super().clean(value)
        if not verify_captcha(token):
            raise forms.ValidationError(self.error_messages["invalid"], code="invalid")
        return token
