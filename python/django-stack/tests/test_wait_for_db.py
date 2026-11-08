from unittest import mock

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db.utils import OperationalError


def test_wrong_password_fails_at_once_with_help():
    error = OperationalError('FATAL:  password authentication failed for user "app"')
    with (
        mock.patch("django.db.connection.ensure_connection", side_effect=error) as connect,
        mock.patch("time.sleep") as sleep,
        pytest.raises(CommandError, match="docker compose down --volumes"),
    ):
        call_command("wait_for_db")
    assert connect.call_count == 1
    sleep.assert_not_called()


def test_waits_while_the_database_starts():
    starting = OperationalError("connection refused")
    with (
        mock.patch("django.db.connection.ensure_connection", side_effect=[starting, None]) as connect,
        mock.patch("time.sleep"),
    ):
        call_command("wait_for_db")
    assert connect.call_count == 2
