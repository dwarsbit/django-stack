"""Abstract models for content that is drafted and published."""

from django.db import models
from django.utils import timezone
from django.utils.translation import gettext_lazy as _


class PublishableQuerySet(models.QuerySet):
    def published(self):
        """Objects with the status published and a publish date that has passed (or none)."""
        return self.filter(status=PublishableModel.Status.PUBLISHED).filter(
            models.Q(published_at__isnull=True) | models.Q(published_at__lte=timezone.now())
        )


class PublishableModel(models.Model):
    """
    A status (draft or published) and a publish date. The content API
    serves only published objects, unless the request carries a valid
    preview token (see ``django_stack.rest.filters.PublishedFilter``).
    """

    class Status(models.TextChoices):
        DRAFT = "draft", _("Draft")
        PUBLISHED = "published", _("Published")

    status = models.CharField(_("status"), max_length=20, choices=Status.choices, default=Status.DRAFT)
    published_at = models.DateTimeField(
        _("publish date"),
        null=True,
        blank=True,
        help_text=_("Leave empty to publish right away. A future date schedules the publication."),
    )

    objects = PublishableQuerySet.as_manager()

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.status == self.Status.PUBLISHED and self.published_at is None:
            self.published_at = timezone.now()
            if kwargs.get("update_fields") is not None:
                kwargs["update_fields"] = {*kwargs["update_fields"], "published_at"}
        super().save(*args, **kwargs)

    @property
    def is_published(self) -> bool:
        return self.status == self.Status.PUBLISHED and (
            self.published_at is None or self.published_at <= timezone.now()
        )
