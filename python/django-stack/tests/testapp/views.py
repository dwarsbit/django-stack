from django import forms
from django.http import Http404
from django.shortcuts import render

from django_stack.contrib.captcha.forms import CaptchaField
from django_stack.contrib.site import published, site_page

from .models import Article

calls = {"article": 0}


@site_page
def article(request, slug):
    calls["article"] += 1
    found = published(Article.objects.all(), request).filter(slug=slug).first()
    if found is None:
        raise Http404
    return render(request, "testapp/article.html", {"article": found, "site": {"site_name": "Test site"}})


class ContactForm(forms.Form):
    email = forms.EmailField()
    captcha = CaptchaField()


@site_page(cache_page=False, captcha=True)
def contact(request):
    form = ContactForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        return render(request, "testapp/contact.html", {"form": ContactForm(), "sent": True})
    return render(request, "testapp/contact.html", {"form": form})
