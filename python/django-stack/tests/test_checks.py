from django.test import override_settings

from django_stack.checks import check_deploy


@override_settings(HUEY={"immediate": True})
def test_tasks_in_the_request_have_their_own_check_id():
    ids = [warning.id for warning in check_deploy(None)]
    # W006 belongs to the Umami settings.
    assert "django_stack.W007" in ids
    assert "django_stack.W006" not in ids
