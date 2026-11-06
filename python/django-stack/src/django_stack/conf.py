"""Access to the DJANGO_STACK settings with their defaults."""

from django.conf import settings

DEFAULTS = {
    "PREVIEW_SECRET": None,
    "PREVIEW_MAX_AGE": 3600,
    "PREVIEW_HEADER": "X-Preview-Token",
    "REVALIDATE_URL": None,
    "REVALIDATE_SECRET": None,
    "REVALIDATE_TIMEOUT": 5,
    "PUBLIC_CREATE": [],
    "CONTENT_APPS": ["content"],
    "SEED_CONTENT": None,
    "ADMIN_USERNAME": "admin",
    "ADMIN_EMAIL": None,
    "ADMIN_PASSWORD": None,
    "BACKUP_DIR": None,
    "BACKUP_KEEP": 14,
    "BACKUP_TIME": "03:00",
    "BACKUP_S3_BUCKET": None,
    "BACKUP_S3_PREFIX": "backups/",
    "BACKUP_S3": {},
    "BACKUP_MEDIA": True,
    "BACKUP_DAILY": False,
    "UMAMI_URL": None,
    "UMAMI_WEBSITE_ID": None,
    "UMAMI_USERNAME": "admin",
    "UMAMI_PASSWORD": None,
}


def get(name: str):
    configured = getattr(settings, "DJANGO_STACK", None) or {}
    if name in configured:
        return configured[name]
    return DEFAULTS[name]
