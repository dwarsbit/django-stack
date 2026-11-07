---
sidebar_position: 8.6
---

# 🧩 Django templates

`init --frontend templates` makes a project where Django renders the site
with its own templates: no `frontend/` directory, no frontend service and
no Node. The pages, the blog, the feeds and the contact form are the same as
in the Astro starter, with the same stylesheet.

```bash
npx @django-stack/cli init my-site --frontend templates
```

## What it has

- A `website` app in `backend/website/`, yours to change:
  - `views.py`: the pages, the blog, categories, tags, the feeds and the contact form.
  - `urls.py`: their routes, included last in `config/urls.py`.
  - `templates/website/`: `base.html` (the layout) and the pages,
    `includes/`, and `blocks/` with one template per block type.
  - `static/website/global.css`: the stylesheet.
  - `forms.py`: the contact form.
  - `tests/`: tests of every page.
- Django serves the whole domain, `SITE_PORT` in development (http://localhost:3000)
  and behind Caddy in production. Templates and CSS reload on save.
- The pages read the content with the ORM, in the same process: no API key
  and no HTTP round trip. `published(queryset, request)` applies the same
  rules as the content API: drafts and scheduled posts stay hidden, except
  in preview.
- The content API stays open for the read-only key, for a mobile app or a
  JavaScript frontend later on.
- The package manager option does not apply.

The shared parts are in the `django-stack` package, `django_stack.contrib.site`,
so `dstack update` brings their fixes.

## Preview

The admin's **Preview** button opens `/preview` with a signed token. The
site keeps it in a cookie until it expires, shows drafts and a banner, and
skips the page cache. `/preview/exit` leaves the preview.

## The page cache

`@site_page` on a view keeps its page in Django's cache, the database by
default, for `SITE_CACHE_TTL` seconds (300). A save or a delete of content,
in the admin or anywhere else, empties it, so a change shows on the next
visit. The cache is skipped in preview, with `DJANGO_DEBUG=1`, and for pages
with a form. With `--cache off` each process has its own cache, so a change
can take up to `SITE_CACHE_TTL` to show everywhere.

## Blocks, images and SEO

```django
{% load stack %}
{% blocks page.body %}
{% image post.cover size="card" sizes="(min-width: 40rem) 22rem, 100vw" %}
{% seo post site type="article" %}
```

- `{% blocks %}` renders each block with
  `website/templates/website/blocks/<type>.html`, which gets the block's
  fields as `value`. To add a block type, add its template; a type without
  one renders nothing.
- `{% image %}` renders an `<img>` of a media library item with a `srcset`
  of its image sizes, its alt text and its focal point.
- `{% seo %}` renders the title, the description, the canonical URL and the
  Open Graph tags; empty fields fall back to the site settings.
- `{{ item|link_href }}` is the URL of a menu link; `is_current` marks the
  current page in the menu.

## Security

`@site_page` sets a Content-Security-Policy: scripts and styles only from
the site, no inline scripts, images from the site and the media origin
(S3 or a CDN). Put scripts and styles in `website/static/website/`. The
contact page also allows what the captcha widget needs.

The contact form posts to its own page, with Django's CSRF protection, the
[captcha](captcha.md) (`CaptchaField`) and the API's rate limit per IP
address (`PUBLIC_WRITE_THROTTLE_RATE`). Submissions appear in the admin and
notify the editors.

## Redirects and analytics

The redirects editors add in the admin answer paths that do not exist, with
`RedirectMiddleware`. [Page analytics](analytics.md) works as with the
other frontends: Umami's tracker loads from `/_a/`, which Caddy serves in
production and Django in development.
