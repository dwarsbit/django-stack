from django.test import override_settings

from django_stack.views import start


def test_start_page_links_to_the_admin_and_the_schema(rf, settings):
    settings.PROJECT_NAME = "site"
    response = start(rf.get("/"))
    response.render()
    html = response.content.decode()
    assert response.status_code == 200
    assert "<h1>site</h1>" in html
    assert 'href="/admin/"' in html
    assert 'href="/api/schema"' in html
    assert response["Content-Security-Policy"].startswith("default-src 'none'")


@override_settings(HEADLESS={"SCHEMA": False})
def test_start_page_without_the_schema(rf):
    response = start(rf.get("/"))
    response.render()
    assert "/api/schema" not in response.content.decode()


def test_start_page_only_answers_reads(rf):
    assert start(rf.post("/")).status_code == 405
