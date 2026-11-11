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


def test_checks_around_the_pool():
    # A pool hides the reason behind a timeout, so the check connects directly.
    from django.db import connection

    error = connection.Database.OperationalError('FATAL:  password authentication failed for user "app"')
    with (
        mock.patch.object(connection, "vendor", "postgresql"),
        mock.patch.dict(connection.settings_dict, {"OPTIONS": {"pool": True}}),
        mock.patch.object(connection, "get_connection_params", return_value={}),
        mock.patch.object(connection.Database, "connect", side_effect=error) as connect,
        mock.patch("django.db.connection.ensure_connection") as ensure,
        pytest.raises(CommandError, match="docker compose down --volumes"),
    ):
        call_command("wait_for_db")
    connect.assert_called_once()
    ensure.assert_not_called()
