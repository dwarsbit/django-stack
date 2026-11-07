from django.urls import include, path, re_path

from . import views

urlpatterns = [
    path("", include("django_stack.contrib.site.urls")),  # /preview and /preview/exit
    path("", views.home, name="home"),
    path("blog", views.blog, name="blog"),
    path("blog/<slug:slug>", views.post, name="post"),
    path("category/<slug:slug>", views.category, name="category"),
    path("tag/<slug:slug>", views.tag, name="tag"),
    path("rss.xml", views.rss, name="rss"),
    path("sitemap.xml", views.sitemap, name="sitemap"),
    path("robots.txt", views.robots, name="robots"),
    # Pages at their path, such as /about or /about/team.
    re_path(r"^(?P<path>[\w-]+(?:/[\w-]+)*)/?$", views.page, name="page"),
]
