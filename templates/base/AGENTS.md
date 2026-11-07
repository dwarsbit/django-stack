# {{project_name}}: guide for AI agents

<!-- @if frontend -->
A website built with DjangoStack: a Django backend (Django Headless serves
the content API, Django Content Studio is the admin) and a frontend built
with {{frontend_label}} that renders the content, run with Docker Compose.
`frontend/AGENTS.md` describes the frontend.
<!-- @end -->
<!-- @if headless -->
A headless project built with DjangoStack: a Django backend (Django Headless
serves the content API, Django Content Studio is the admin), run with Docker
Compose. It has no frontend; other apps read the API with the read-only key.
<!-- @end -->
<!-- @if templates -->
A website built with DjangoStack: a Django backend (Django Headless serves
the content API, Django Content Studio is the admin) that also renders the
site with Django templates, in the `website` app, run with Docker Compose.
There is no Node and no frontend service: the pages read the content with
the ORM.
<!-- @end -->

## Layout

```
backend/                 Django project
  config/settings.py     settings; environment-driven ones come from django_stack.settings.configure
  config/studio.py       the Content Studio site (admin extensions)
  content/models.py      the content models: Page, Post, Category, Tag, Author, Menu, SiteSettings, Redirect, FormSubmission
  content/blocks.py      the blocks of page and post bodies
  content/admin.py       how each model looks in the admin (studios)
  content/seed.py        demo content
  content/tests/         pytest tests of the API
<!-- @if templates -->
  website/views.py       the site's pages; they read content with published(), which hides drafts outside preview
  website/urls.py        the site's routes, included last in config/urls.py
  website/templates/website/  base.html (the layout), the pages, includes/ and blocks/ (one template per block type)
  website/static/website/global.css  the site's stylesheet
  website/forms.py       the contact form, with the captcha
  website/tests/         pytest tests of the pages
<!-- @end -->
<!-- @if frontend -->
frontend/                the {{frontend_label}} site; frontend/AGENTS.md lists its files
  src/lib/headless.ts    generated API types; do not edit, run `{{pm_run}} generate:types`
<!-- @end -->
compose.yaml             every service; COMPOSE_PROFILES in .env picks dev or prod
Caddyfile                the prod profile's reverse proxy and HTTPS
.github/workflows/deploy.yml  optional deploy to a server over SSH
.env                     secrets and settings; never commit, never print
```

## Commands

Run them at the project root. They need Docker; Node is only needed for the `{{pm_run}}` shortcuts.

| Task | Command |
|------|---------|
| Start everything | `docker compose up --build` (or `{{pm_run}} dev`) |
| Run a manage.py command | `docker compose exec backend python manage.py <command>` (or `{{pm_backend}} <command>`) |
| Make migrations after a model change | `docker compose exec backend python manage.py makemigrations` |
<!-- @if frontend -->
| Regenerate the API types after a model change | `{{pm_run}} generate:types` |
<!-- @end -->
<!-- @if !frontend -->
| Write the OpenAPI schema to `backend/openapi.json` | `{{pm_run}} generate:types` |
<!-- @end -->
| Run the tests | `{{pm_run}} test` |
<!-- @if frontend -->
| Lint and type-check | `{{pm_run}} lint` |
<!-- @end -->
<!-- @if !frontend -->
| Lint | `{{pm_run}} lint` |
<!-- @end -->
| Logs | `docker compose logs --follow backend` |
| Production settings for a server | `npx @django-stack/cli production --domain example.com` |

<!-- @if frontend -->
In production (`COMPOSE_PROFILES=prod,db`) the services are `backend-prod`,
`worker-prod` (which also runs the daily backup), `frontend-prod` and
`proxy`, with `umami` for page analytics when the `analytics` profile is on;
their containers are
<!-- @end -->
<!-- @if headless -->
In production (`COMPOSE_PROFILES=prod,db`) the services are `backend-prod`,
`worker-prod` (which also runs the daily backup) and `proxy`; their
containers are
<!-- @end -->
<!-- @if templates -->
In production (`COMPOSE_PROFILES=prod,db`) the services are `backend-prod`,
`worker-prod` (which also runs the daily backup) and `proxy`, with `umami`
for page analytics when the `analytics` profile is on; their containers are
<!-- @end -->
read-only, so a change goes through the code and a new image, never an edit
in a running container.

## How to add a content model

1. Define the model in `backend/content/models.py` and decorate it with
   `@expose()` (add `read_only=True` for content the frontend only reads).
2. Register it in `backend/content/admin.py` with `@register(Model)` and a
   `ModelStudio`.
3. Run `makemigrations`; the backend migrates on its next start, or run
   `migrate`.
<!-- @if frontend -->
4. Run `{{pm_run}} generate:types`, then read it in the frontend as
   `frontend/AGENTS.md` shows.
<!-- @end -->
<!-- @if headless -->
4. Its routes are under `/api/`; `/api/schema` describes them.
<!-- @end -->
<!-- @if templates -->
4. Show it on the site: a view in `backend/website/views.py` that reads it
   with `published(Model.objects.all(), request)` when it has a status, a
   route in `website/urls.py` and a template in `website/templates/website/`.
   Decorate the view with `@site_page`, which caches the page until content
   changes and sets the Content-Security-Policy.
<!-- @end -->
5. Add an API smoke test to `backend/content/tests/test_api.py`.

## How to add a block type

1. Add a `Block` subclass in `backend/content/blocks.py` and add it to
   `BODY_BLOCKS`. Blocks need no migration.
<!-- @if frontend -->
2. Render it in the frontend as `frontend/AGENTS.md` shows.
<!-- @end -->
<!-- @if templates -->
2. Add `backend/website/templates/website/blocks/<type>.html`; it gets the
   block's fields as `value`. `{% blocks page.body %}` renders nothing for
   a type without a template.
<!-- @end -->

## Rules

- Never edit `.env` values you were not asked to change, and never print secrets.
- Never write migrations by hand; use `makemigrations`.
<!-- @if !templates -->
- The frontend only ever holds `API_READ_KEY`. Never give it `API_SECRET_KEY`.
<!-- @end -->
- API routes are closed by default. Opening a model to anonymous writes goes
  through `DJANGO_STACK["PUBLIC_CREATE"]` in `config/settings.py`, and is
  rate limited.
<!-- @if frontend -->
- Django owns `/admin`, `/api`, `/media` and `/static`; frontend routes must
  not use these prefixes.
<!-- @end -->
<!-- @if templates -->
- `/admin`, `/api`, `/media`, `/static` and `/_a` are taken; site routes
  must not use these prefixes.
- The site's pages use no inline scripts or styles: the
  Content-Security-Policy of `@site_page` blocks them. Add files to
  `website/static/website/` instead.
- HTML from an `HTMLField` (`|safe`) is sanitized when it is saved; never
  mark other text safe.
<!-- @end -->
