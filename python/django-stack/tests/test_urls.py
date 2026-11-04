from django.test import override_settings

from django_stack.urls import media_urlpatterns


@override_settings(DEBUG=True, MEDIA_URL="http://localhost:3000/media/")
def test_serves_an_absolute_media_url_in_debug():
    patterns = media_urlpatterns()
    assert len(patterns) == 1
    assert patterns[0].pattern.match("media/a/b.jpg")


@override_settings(DEBUG=False, MEDIA_URL="http://localhost:3000/media/")
def test_serves_nothing_without_debug():
    assert media_urlpatterns() == []


@override_settings(DEBUG=True, MEDIA_URL="https://bucket.example.com/")
def test_serves_nothing_for_a_bucket_root():
    assert media_urlpatterns() == []
