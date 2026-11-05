# {{project_name}}

A website with a Django backend and a frontend built with {{frontend_label}}, created with
[DjangoStack](https://github.com/dwarsbit/django-stack).

- [Django Headless](https://djangoheadless.org) serves the content API.
- [Django Content Studio](https://djangocontentstudio.org) is the admin.
- [{{frontend_label}}]({{frontend_url}}) renders the site.
- Postgres stores the content; Valkey is the cache and task queue.

## Start

You need Docker.

```bash
docker compose up --build
```

- Site: http://localhost:3000
- Admin: http://localhost:3000/admin/ (user `admin`, password `ADMIN_PASSWORD` in `.env`)
- Outgoing mail: http://localhost:8025

The first start migrates the database, creates the admin user and adds demo
content. Edit a page in the admin, publish, and reload the site.

## Develop

Both sides reload on save: the backend runs Django's development server and
the frontend {{frontend_label}}'s, with the source mounted from `backend/` and
`frontend/`. `AGENTS.md` lists the layout and the commands.

| Task | Command |
|------|---------|
| Run a manage.py command | `docker compose exec backend python manage.py <command>` |
| Make migrations | `docker compose exec backend python manage.py makemigrations` |
| Regenerate the API types | `npm run generate:types` |
| Run the tests | `npm test` |
| Check the setup | `npm run doctor` |

With the `dstack` command installed (`npm install --global @django-stack/cli`),
`dstack dev`, `dstack check`, `dstack manage <command>` and `dstack types` do
the same from any directory in the project. See the
[CLI reference](https://dwarsbit.github.io/django-stack/docs/cli).

## Preview and publishing

Pages and posts have a status. Drafts and posts with a future publish date
are not served by the API. The **Preview** button in the admin opens the
site with drafts shown, for an hour.

When an editor saves, Django tells the frontend (`REVALIDATE_URL`), which
empties its page cache, so the change shows on the next visit.

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
GitHub Actions. The [deployment guide](https://dwarsbit.github.io/django-stack/docs/production/server)
has every step.

| Task | Command (on the server) |
|------|---------|
| Update | `git pull && docker compose up -d --build` |
| Back up the database and media now | `docker compose exec worker-prod python manage.py backup_database` |
| List backups | `docker compose exec worker-prod python manage.py backup_database --list` |
| Restore | `docker compose exec worker-prod python manage.py restore_database <name> --media` |
| Logs | `docker compose logs --follow backend-prod` |

## Security

- The API answers only requests with a key. The frontend holds the
  read-only key (`API_READ_KEY`) and uses it on the server only.
- `API_SECRET_KEY` can write: keep it for scripts and never give it to the
  frontend.
- `.env` holds every secret. It is generated with random values and is not
  committed.

See `SECURITY.md` to report a problem.
