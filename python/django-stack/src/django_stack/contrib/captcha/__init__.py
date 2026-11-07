"""
DjangoStack's captcha: the Cap protocol (https://capjs.js.org), a proof of
work the visitor's browser solves, with no third party and no tracking.

Add ``"django_stack.contrib.captcha"`` to ``INSTALLED_APPS``. Then:

- ``/api/cap/challenge`` and ``/api/cap/redeem`` serve the ``@cap.js/widget``
  web component, and ``/api/cap/solver.wasm`` its solver, from this site.
- Every create in ``PUBLIC_CREATE`` needs a ``captcha`` field with a token
  the widget redeemed, unless the request carries an API key or comes from
  a staff user.
- ``CaptchaField`` adds the same check to a serializer of your own, and
  ``verify_captcha(token)`` to any other view.

``CAPTCHA=off`` turns the check off.
"""

from .tokens import verify_captcha

__all__ = ["verify_captcha"]
