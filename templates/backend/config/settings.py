"""
Settings of the {{project_name}} backend.

The environment-driven settings (secrets, database, cache, mail, hosts,
storage) and the defaults for Django Headless and Django Content Studio
come from ``django_stack.settings.configure``; see the variables in
``.env.example`` at the project root. Settings below the call override it.
"""

from pathlib import Path

import django_stack.settings

BASE_DIR = Path(__file__).resolve().parent.parent

DJANGO_STACK = {
    # Models anyone may create through the API, such as the contact form.
    "PUBLIC_CREATE": ["content.formsubmission"],
    # The apps export_content and import_content move between environments.
    "CONTENT_APPS": ["content"],
    # The function `manage.py seed_content` runs.
    "SEED_CONTENT": "content.seed.seed",
}

django_stack.settings.configure(globals(), base_dir=BASE_DIR)

INSTALLED_APPS = [
    "django.contrib.admin",  # Content Studio records its activity log with it
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "huey.contrib.djhuey",
    "huey.contrib.djhuey.stats",
    "headless",
    "content_studio",
    "content_studio.media_library",
    "content_studio.contrib.password_reset",
    "content_studio.notifications",  # notifications in the admin and by email
    "django_stack",
    "django_stack.contrib.captcha",  # the captcha of the contact form (CAPTCHA=off turns it off)
    "content",
    # Last: builds the API routes once every model is exposed.
    "headless.rest",
]

MIDDLEWARE = [
    "django_stack.logs.RequestIdMiddleware",  # request IDs and the access log
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
