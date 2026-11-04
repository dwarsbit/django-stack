"""The static files storage of production: WhiteNoise's compressed manifest."""

from __future__ import annotations

from whitenoise.storage import CompressedManifestStaticFilesStorage


class StaticFilesStorage(CompressedManifestStaticFilesStorage):
    """Hashed, compressed static files that also accept ``{% static '' %}``.

    Templates use ``{% static '' %}`` for the static prefix (Content Studio
    does); the manifest has no entry for it, so it returns STATIC_URL instead
    of failing the page.
    """

    def url(self, name: str | None, force: bool = False) -> str:
        if not name:
            return str(self.base_url)
        return super().url(name, force)
