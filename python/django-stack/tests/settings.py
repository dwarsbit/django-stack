from pathlib import Path

import django_stack.settings

BASE_DIR = Path(__file__).resolve().parent

DJANGO_STACK = {
    "PUBLIC_CREATE": ["testapp.message"],
    "CONTENT_APPS": ["testapp"],
    "SITE_REDIRECT_MODEL": "testapp.Redirect",
}

django_stack.settings.configure(
    globals(),
    base_dir=BASE_DIR,
    env={
        "DJANGO_SECRET_KEY": "test-secret-key-" + "x" * 50,
        "DJANGO_DEBUG": "0",
        "DATABASE_URL": "sqlite://:memory:",
        "API_SECRET_KEY": "write-key",
        "API_READ_KEY": "read-key",
        "PREVIEW_SECRET": "preview-secret",
        "SITE_URL": "http://testserver",
        "PROJECT_NAME": "test",
        "ERRORS": "off",
    },
)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "headless",
    "content_studio",
    "content_studio.media_library",
    "content_studio.notifications",
    "django_stack",
    "django_stack.contrib.captcha",
    "django_stack.contrib.site",
    "tests.testapp",
    "headless.rest",
]
MIDDLEWARE = [
    "django_stack.logs.RequestIdMiddleware",  # request IDs and the access log
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django_stack.contrib.site.middleware.RedirectMiddleware",
]
ROOT_URLCONF = "tests.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "django_stack.contrib.site.context_processors.site",
            ]
        },
    }
]
USE_TZ = True
CONTENT_STUDIO["ADMIN_SITE"] = "content_studio.admin.admin_site"  # noqa: F821
HEADLESS["BOOT_LOG"] = False  # noqa: F821
