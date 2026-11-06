"""
The notifications of the site, with Content Studio's notifications app
(`content_studio.notifications` in INSTALLED_APPS). Editors get them in
the admin and, when they leave them unread, in an email digest. Each
editor picks which events they get on their settings page.

Register your own events here, and send them with notify(); see
https://djangocontentstudio.org for the API.
"""

from content_studio.notifications import notify, register_event
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils.translation import gettext_lazy as _

from .models import FormSubmission

FORM_SUBMITTED = register_event(
    "site.form_submitted",
    _("Contact form messages"),
    _("A visitor sent a message with the contact form."),
)


@receiver(post_save, sender=FormSubmission, dispatch_uid="content_form_submitted")
def notify_form_submitted(sender, instance, created, raw=False, **kwargs):
    """Every editor who may read the messages hears about a new one."""
    if created and not raw:
        notify(
            FORM_SUBMITTED.key,
            title=_("Message from %(name)s"),
            # The visitor's text goes in params: a "%" in it stays text.
            body=_("%(message)s"),
            params={"name": instance.name, "message": instance.message[:200]},
            target=instance,
        )
