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
