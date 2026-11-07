---
sidebar_position: 4
---

# ⚙️ Configuration

A project is configured with environment variables in `.env`. Docker Compose
passes them to the backend and the worker. The frontend receives only the
variables it needs: never the full-access API key or the database password.

The backend reads them in `config/settings.py` through
`django_stack.settings.configure()`, which sets Django's settings from the
environment. Settings you define in `config/settings.py` before the call are
kept, and dictionaries such as `REST_FRAMEWORK` are merged over the defaults.

## Variables

| Variable | Description |
|----------|-------------|
| `SITE_URL` | The public URL of the site. |
| `BACKEND_URL` | The public URL of the backend. In development the frontend's dev server serves `/admin`, `/api` and `/media`, so it is the same as `SITE_URL`. |
| `DJANGO_SECRET_KEY` | Django's secret key. Required. |
| `DJANGO_DEBUG` | `1` in development, `0` in production. |
| `DATABASE_URL` | `postgres://user:password@host:5432/name`, or `sqlite:///path`. |
| `PRODUCTION_DATABASE_URL` | An external Postgres for the server. `dstack production` makes it `DATABASE_URL` in `.env.production` and leaves out `db`; development keeps the bundled Postgres. |
| `CACHE_URL` | `db://` for a table in the database, `redis://` or `valkey://` for Valkey, `locmem://` for a cache per process. |
| `TASKS_URL` | Where the worker's task queue is: `db://` (tables in the database), `redis://cache:6379/1` (Valkey) or `immediate://` (no worker: tasks run in the request, and there are no daily backups). Without it, the queue is in a Redis `CACHE_URL`, as in projects from before 0.7. |
| `TASK_WORKERS` | The number of worker containers: `1`, or `0` with `TASKS_URL=immediate://`. |
| `EMAIL_URL` | `smtp://user:password@host:25`, `smtp+tls://` for STARTTLS on port 587, `smtps://` for TLS on port 465, or `console://` to print mail. |
| `DEFAULT_FROM_EMAIL` | The sender of the mail the site sends. |
| `API_SECRET_KEY` | The full-access API key, for scripts. |
| `API_READ_KEY` | The read-only API key, for the frontend. It must differ from `API_SECRET_KEY`. |
| `PREVIEW_SECRET` | Signs preview links. Shared with the frontend. |
| `REVALIDATE_SECRET` | Signs the requests that tell the frontend content changed. Shared with the frontend. |
| `REVALIDATE_URL` | Where the backend sends those requests. |
| `ALLOWED_HOSTS` | Extra host names, separated by commas. The hosts of `SITE_URL` and `BACKEND_URL` are always allowed. |
| `COMPOSE_PROFILES` | The services Docker Compose starts: `dev,db` in development, `prod,db` on a server. Leave out `db` for an external Postgres (`dstack production` does with `PRODUCTION_DATABASE_URL`); add `s3` in development for the local S3 service. `analytics` runs Umami, `valkey` the Valkey service. |
| `NUM_PROXIES` | The number of reverse proxies in front of the backend, so client IPs and HTTPS are detected. The `prod` profile sets 1, for Caddy. |
| `S3_BUCKET` and the other `S3_*` | Store uploads in S3 instead of on disk. See [Media and database](./production/media-and-database.md). |
| `UMAMI_URL` and the other `UMAMI_*` | Page analytics with Umami. See [Page analytics](./analytics.md#variables). |
| `BACKUP_TIME`, `BACKUP_KEEP`, `BACKUP_S3_BUCKET` | The daily database backup. See [Backups](./production/backups.md). |
| `BACKUP_PING_URL` | Requested after each daily backup, for an alert when backups stop. See [Health checks](./production/logs.md#alerts-for-missed-backups). |
| `CADDY_ADDRESS`, `TRUSTED_PROXIES`, `HTTP_PORT`, `HTTPS_PORT` | Caddy behind a platform's proxy. See [Coolify and Dokploy](./production/platforms.md). |
| `CAPTCHA`, `CAPTCHA_THROTTLE_RATE` | The captcha of the contact form, `on` or `off`. See [Captcha](./captcha.md). |
| `ERRORS`, `ERROR_EMAIL` | Error reports by email and in the admin, or to Sentry. See [Error reports](./production/logs.md#error-reports). |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` | Error reports to Sentry with `ERRORS=sentry`. See [Sentry](./production/logs.md#sentry). |
| `LOG_FORMAT`, `LOG_LEVEL`, `LOG_ACCESS` | The format and level of the logs. See [Logs and health checks](./production/logs.md). |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SECURE_HSTS_PRELOAD` | Extend HSTS to subdomains and the preload list. Off by default. |
| `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The admin user created on the first start. |
| `SEED_DEMO_CONTENT` | `1` adds the demo content to an empty site on the first start. |

## System checks

`python manage.py check` reports configurations that are not safe:

| Check | Problem |
|-------|---------|
| `django_stack.E001` | The two API keys are the same. |
| `django_stack.E002` | There is no read-only API key. |
| `django_stack.E003` | Debug is on for an `https` site. |
| `django_stack.E004` | An entry of `DJANGO_STACK["PUBLIC_CREATE"]` is not a model. |
| `django_stack.W001` | A revalidation URL without a secret. |
| `django_stack.W002` | No preview secret. |
| `django_stack.W003` | The secret key is short (with `--deploy`). |
| `django_stack.W004` | The cache is in local memory (with `--deploy`). |
| `django_stack.W005` | An `https` site without `NUM_PROXIES`, so Django cannot tell requests came over HTTPS (with `--deploy`). |
| `django_stack.W006` | `UMAMI_URL` without `UMAMI_ADMIN_PASSWORD` or `UMAMI_WEBSITE_ID`. |
