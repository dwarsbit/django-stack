import pytest


@pytest.fixture(autouse=True)
def _no_revalidate(settings):
    """Tests never call the frontend."""
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "REVALIDATE_URL": None}
