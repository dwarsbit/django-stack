from django.db import models


class Challenge(models.Model):
    """A challenge the widget is solving. Redeeming it deletes it, solved or not."""

    token = models.CharField(max_length=64, primary_key=True)
    count = models.PositiveSmallIntegerField()
    size = models.PositiveSmallIntegerField()
    difficulty = models.PositiveSmallIntegerField()
    expires_at = models.DateTimeField(db_index=True)

    def __str__(self):
        return self.token


class Token(models.Model):
    """A redeemed challenge: a form submission may use it once, before it expires."""

    id = models.CharField(max_length=32, primary_key=True)
    # The SHA-256 of the secret half of the token, which only the visitor has.
    digest = models.CharField(max_length=64)
    expires_at = models.DateTimeField(db_index=True)

    def __str__(self):
        return self.id
