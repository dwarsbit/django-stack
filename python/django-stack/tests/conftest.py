import pytest
from rest_framework.test import APIClient


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def read_client():
    return APIClient(headers={"X-Secret-Key": "read-key"})


@pytest.fixture
def write_client():
    return APIClient(headers={"X-Secret-Key": "write-key"})


@pytest.fixture
def no_captcha(settings):
    """CAPTCHA=off: public creates need no captcha token."""
    settings.DJANGO_STACK = {**settings.DJANGO_STACK, "CAPTCHA": False}
