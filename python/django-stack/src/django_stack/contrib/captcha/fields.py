from django.utils.translation import gettext_lazy as _
from rest_framework import serializers

from .tokens import verify_captcha


class CaptchaField(serializers.CharField):
    """
    A write-only serializer field for the token of the captcha widget. It
    is valid once for each token; the validated value is the token.

        class SignupSerializer(serializers.Serializer):
            email = serializers.EmailField()
            captcha = CaptchaField()

            def create(self, validated_data):
                validated_data.pop("captcha")
                ...
    """

    default_error_messages = {
        "invalid": _("The captcha is not valid or has expired. Verify that you are human and try again."),
    }

    def __init__(self, **kwargs):
        kwargs.setdefault("write_only", True)
        kwargs.setdefault("max_length", 100)
        kwargs.setdefault(
            "error_messages",
            {"required": _("Verify that you are human."), "blank": _("Verify that you are human.")},
        )
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        token = super().to_internal_value(data)
        if not verify_captcha(token):
            self.fail("invalid")
        return token
