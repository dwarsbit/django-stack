from django.test import override_settings

from django_stack.staticfiles import StaticFilesStorage


@override_settings(STATIC_URL="/static/")
def test_empty_name_is_the_static_prefix(tmp_path):
    storage = StaticFilesStorage(location=tmp_path)
    assert storage.url("") == "/static/"
