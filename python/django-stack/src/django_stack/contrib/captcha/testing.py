"""Helpers for a project's tests."""

from .tokens import issue_token


def captcha_token() -> str:
    """A valid captcha token, as if the widget solved a challenge; valid once."""
    return issue_token()[0]
