from django.urls import path

from . import views

urlpatterns = [
    path("challenge", views.ChallengeView.as_view(), name="django-stack-captcha-challenge"),
    path("redeem", views.RedeemView.as_view(), name="django-stack-captcha-redeem"),
    path("solver.wasm", views.solver, name="django-stack-captcha-solver"),
]
