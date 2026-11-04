# {{project_name}}: guide for AI agents

A website built with DjangoStack: a Django backend (Django Headless serves
the content API, Django Content Studio is the admin) and an Astro frontend
that renders the content, run with Docker Compose.

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
frontend/                Astro site (server output, Node adapter)
  src/pages/             routes: /, /[...slug], /blog, /blog/[slug], /category/[slug], /tag/[slug], sitemap.xml, rss.xml, robots.txt, /preview, /revalidate
  src/components/        Blocks.astro maps block types to components in components/blocks/
  src/lib/api.ts         getContent(): content helpers with the read-only key, drafts in preview
  src/lib/headless.ts    generated API types; do not edit, run `npm run generate:types`
  src/middleware.ts      page cache, editor-managed redirects, security headers
compose.yaml             every service; COMPOSE_PROFILES in .env picks dev or prod
Caddyfile                the prod profile's reverse proxy and HTTPS
.github/workflows/deploy.yml  optional deploy to a server over SSH
.env                     secrets and settings; never commit, never print
```

## Commands

Run them at the project root. They need Docker; Node is only needed for the `npm run` shortcuts.

| Task | Command |
|------|---------|
| Start everything | `docker compose up --build` (or `npm run dev`) |
| Run a manage.py command | `docker compose exec backend python manage.py <command>` (or `npm run backend -- <command>`) |
| Make migrations after a model change | `docker compose exec backend python manage.py makemigrations` |
| Regenerate the API types after a model change | `npm run generate:types` |
| Run the tests | `npm test` |
| Lint and type-check | `npm run lint` |
| Logs | `docker compose logs --follow backend` |
| Production settings for a server | `npx @django-stack/cli production --domain example.com` |

In production (`COMPOSE_PROFILES=prod,db`) the services are `backend-prod`,
`worker-prod`, `frontend-prod`, `proxy` and `backup`; their containers are
read-only, so a change goes through the code and a new image, never an edit
in a running container.

## How to add a content model

1. Define the model in `backend/content/models.py` and decorate it with
   `@expose()` (add `read_only=True` for content the frontend only reads).
2. Register it in `backend/content/admin.py` with `@register(Model)` and a
   `ModelStudio`.
3. Run `makemigrations`; the backend migrates on its next start, or run
   `migrate`.
4. Run `npm run generate:types`, then read it in the frontend through
   `getClient()` from `src/lib/api.ts`: `getClient(Astro.cookies).model("content.mymodel").list()`.
5. Add an API smoke test to `backend/content/tests/test_api.py`.

## How to add a block type

1. Add a `Block` subclass in `backend/content/blocks.py` and add it to
   `BODY_BLOCKS`. Blocks need no migration.
2. Add a component in `frontend/src/components/blocks/` and map the block's
   type in `frontend/src/components/Blocks.astro`.

## Rules

- Never edit `.env` values you were not asked to change, and never print secrets.
- Never write migrations by hand; use `makemigrations`.
- The frontend only ever holds `API_READ_KEY`. Never give it `API_SECRET_KEY`.
- API routes are closed by default. Opening a model to anonymous writes goes
  through `DJANGO_STACK["PUBLIC_CREATE"]` in `config/settings.py`, and is
  rate limited.
- Django owns `/admin`, `/api`, `/media` and `/static`; frontend routes must
  not use these prefixes.
