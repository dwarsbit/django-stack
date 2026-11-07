from django.apps import AppConfig


class CaptchaConfig(AppConfig):
    name = "django_stack.contrib.captcha"
    label = "django_stack_captcha"
    verbose_name = "Captcha"
    default_auto_field = "django.db.models.BigAutoField"
