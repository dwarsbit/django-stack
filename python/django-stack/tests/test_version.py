import django_stack


def test_version():
    assert django_stack.__version__.count(".") == 2
