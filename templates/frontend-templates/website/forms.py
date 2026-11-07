from django import forms
from django_stack.contrib.captcha.forms import CaptchaField

from content.models import FormSubmission


class ContactForm(forms.ModelForm):
    """The contact form; submissions appear in the admin under Form submissions."""

    # The widget of the captcha; CAPTCHA=off leaves it out.
    captcha = CaptchaField(label="")

    class Meta:
        model = FormSubmission
        fields = ["name", "email", "message"]
        widgets = {
            "name": forms.TextInput(attrs={"autocomplete": "name"}),
            "email": forms.EmailInput(attrs={"autocomplete": "email"}),
            "message": forms.Textarea(attrs={"rows": 6}),
        }
