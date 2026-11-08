# {{project_name}}

<!-- @if frontend -->
A website with a Django backend and a frontend built with {{frontend_label}}, created with
[DjangoStack](https://github.com/dwarsbit/django-stack).
<!-- @end -->
<!-- @if headless -->
A content API and an admin with Django, created with
[DjangoStack](https://github.com/dwarsbit/django-stack). It has no frontend:
build your own against the API, with the read-only key.
<!-- @end -->
<!-- @if templates -->
A website with Django, created with
[DjangoStack](https://github.com/dwarsbit/django-stack): Django renders the
pages with its templates, from the content the API also serves.
<!-- @end -->

- [Django Headless](https://djangoheadless.org) serves the content API.
- [Django Content Studio](https://djangocontentstudio.org) is the admin.
<!-- @if frontend -->
- [{{frontend_label}}]({{frontend_url}}) renders the site.
<!-- @end -->
<!-- @if templates -->
- [Django templates]({{frontend_url}}) render the site: the `website` app
  in `backend/website/`.
<!-- @end -->
- Postgres stores the content, and by default also the cache and the task
  queue (`CACHE_URL` and `TASKS_URL` in `.env`); Valkey can take those over
  with the `valkey` profile.

## Start

You need Docker.

```bash
docker compose up --build
```

<!-- @if site -->
- Site: http://localhost:{{site_port}}
<!-- @end -->
<!-- @if headless -->
- API: http://localhost:{{site_port}}/api/ (with the `X-Secret-Key` header set to `API_READ_KEY` in `.env`), its OpenAPI schema at `/api/schema`
<!-- @end -->
- Admin: http://localhost:{{site_port}}/admin/ (user `admin`, password `ADMIN_PASSWORD` in `.env`)
- Outgoing mail: http://localhost:{{mail_port}}

The ports are `SITE_PORT` and `MAIL_PORT` in `.env`. When you change
`SITE_PORT`, change `SITE_URL` and `BACKEND_URL` with it.

The first start migrates the database, creates the admin user and adds demo
<!-- @if site -->
content. Edit a page in the admin, publish, and reload the site.
<!-- @end -->
<!-- @if headless -->
content. Edit a page in the admin, publish, and read it from the API.
<!-- @end -->

## Develop

<!-- @if frontend -->
Both sides reload on save: the backend runs Django's development server and
the frontend {{frontend_label}}'s, with the source mounted from `backend/` and
`frontend/`. `AGENTS.md` lists the layout and the commands.
<!-- @end -->
<!-- @if headless -->
The backend reloads on save: it runs Django's development server, with the
source mounted from `backend/`. `AGENTS.md` lists the layout and the commands.
<!-- @end -->
<!-- @if templates -->
The site reloads on save, templates and CSS included: the backend runs
Django's development server, with the source mounted from `backend/`. The
pages are in `backend/website/`; `AGENTS.md` lists the layout and the
commands.
<!-- @end -->

| Task | Command |
|------|---------|
| Run a manage.py command | `docker compose exec backend python manage.py <command>` |
| Make migrations | `docker compose exec backend python manage.py makemigrations` |
<!-- @if frontend -->
| Regenerate the API types | `{{pm_run}} generate:types` |
<!-- @end -->
<!-- @if !frontend -->
| Write the OpenAPI schema to `backend/openapi.json` | `{{pm_run}} generate:types` |
<!-- @end -->
| Run the tests | `{{pm_run}} test` |
| Check the setup | `{{pm_run}} doctor` |

With the `dstack` command installed (`npm i -g @django-stack/cli`),
`dstack dev`, `dstack check`, `dstack manage <command>` and `dstack types` do
the same from any directory in the project. See the
[CLI reference](https://djangostack.org/docs/cli).

## Preview and publishing

Pages and posts have a status. Drafts and posts with a future publish date
are not served by the API. The **Preview** button in the admin opens the
site with drafts shown, for an hour.

<!-- @if frontend -->
When an editor saves, Django tells the frontend (`REVALIDATE_URL`), which
empties its page cache, so the change shows on the next visit.
<!-- @end -->
<!-- @if headless -->
The button opens `/preview` on `SITE_URL`, which your frontend serves; set
`REVALIDATE_URL` to the endpoint where your frontend empties its page cache,
and Django calls it when an editor saves. See
[Preview and revalidation](https://djangostack.org/docs/preview-revalidation).
<!-- @end -->
<!-- @if templates -->
The site keeps each page in Django's cache, and empties it when an editor
saves, so the change shows on the next visit. In preview the cache is
skipped.
<!-- @end -->

<!-- @if site -->
## Analytics

When `COMPOSE_PROFILES` in `.env` has `analytics`, the `umami` service
counts page views without cookies, and the admin shows them under
**Analytics**. Umami's own interface is not served: only its tracker and the
page views pass through the site at `/_a/`. To turn it off, remove
`analytics` from `COMPOSE_PROFILES` and empty `UMAMI_URL`. See
[Page analytics](https://djangostack.org/docs/analytics).
<!-- @end -->

## Deploy

On a server with Docker and a domain pointing at it:

```bash
npx @django-stack/cli production --domain example.com --email-url smtp+tls://user:pass@smtp.example.com:587
# copy the project to the server, with .env.production as .env, then there:
docker compose up -d --build
```

The `prod` profile runs production images behind Caddy, which gets the HTTPS
certificate, and backs up the database every day. Media can go to S3 and the
database to a managed Postgres. `.github/workflows/deploy.yml` deploys from
GitHub Actions. The [deployment guide](https://djangostack.org/docs/production/server)
has every step.

| Task | Command (on the server) |
|------|---------|
| Update | `git pull && docker compose up -d --build` |
| Back up the database and media now | `docker compose exec worker-prod python manage.py backup_database` |
| List backups | `docker compose exec worker-prod python manage.py backup_database --list` |
| Restore | `docker compose exec worker-prod python manage.py restore_database <name> --media` |
| Logs | `docker compose logs --follow backend-prod` |

## Security

<!-- @if !templates -->
- The API answers only requests with a key. The frontend holds the
  read-only key (`API_READ_KEY`) and uses it on the server only, never in
  the browser.
<!-- @end -->
<!-- @if templates -->
- The API answers only requests with a key. The site reads the content
  in Django and needs none; the read-only key (`API_READ_KEY`) is for other
  apps, on their server, never in a browser.
<!-- @end -->
- `API_SECRET_KEY` can write: keep it for scripts and never give it to a
  frontend.
- `.env` holds every secret. It is generated with random values and is not
  committed.

See `SECURITY.md` to report a problem.
