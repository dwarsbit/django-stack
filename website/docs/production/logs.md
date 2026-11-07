---
sidebar_position: 4.5
---

# 📜 Logs and health checks

Every service writes its logs to standard output, and Docker keeps them.
`dstack logs <service>` or `docker compose logs --follow <service>` shows
them:

```bash
dstack logs backend-prod
dstack logs proxy
```

## Format

In production (`DJANGO_DEBUG=0`), Django, the worker and Caddy write one
JSON object per line, which log tools and hosting platforms can search
and filter. A line of Django's log:

```json
{"time": "2026-11-06T19:40:12.381+00:00", "level": "INFO", "logger": "django_stack.access", "message": "GET /api/posts 200", "request_id": "8f0c2c3e9b8a4f0e9d7c6b5a4f3e2d1c", "method": "GET", "path": "/api/posts", "status": 200, "duration_ms": 41.7, "user_id": null}
```

Errors add an `exception` field with the traceback. In development the
lines are plain text, `LEVEL logger message`, with the request ID in
brackets.

| Variable | Description |
|----------|-------------|
| `LOG_FORMAT` | `json` or `plain`. `json` when `DJANGO_DEBUG=0`, `plain` otherwise. |
| `LOG_LEVEL` | The lowest level written: `DEBUG`, `INFO` (the default), `WARNING` or `ERROR`. |
| `LOG_ACCESS` | `0` turns off Django's access log. On when `DJANGO_DEBUG=0`; in development `runserver` writes its own. |

`django_stack.settings.configure` sets Django's
[`LOGGING`](https://docs.djangoproject.com/en/stable/topics/logging/#configuring-logging)
setting from these variables. To change more, assign `LOGGING` in
`backend/config/settings.py` after the call.

## Request IDs

Caddy gives every request an ID and sends it to Django and the frontend
in the `X-Request-ID` header; an ID the client sends is replaced. Caddy's
own log line carries it as `request_id`.

`django_stack.logs.RequestIdMiddleware`, the first entry of `MIDDLEWARE`
in `backend/config/settings.py`, adds the ID to every line Django logs
while it handles the request, writes one access log line per request on
the `django_stack.access` logger, and returns the ID in the response's
`X-Request-ID` header. Without Caddy, as in development, it creates an ID.
To find everything one request logged, search the logs for its ID:

```bash
docker compose logs backend-prod proxy | grep 8f0c2c3e9b8a4f0e9d7c6b5a4f3e2d1c
```

The health checks at `/healthz` and `/readyz` run every few seconds, so
the access log leaves them out unless they fail.

## Error reports

With `ERRORS=email` (the default of `dstack init`) and `DJANGO_DEBUG=0`,
every line logged at `ERROR`, such as a server error (500), a task of the
worker that failed or a failed backup, is reported to the superusers:

- **By email**, with the traceback and the request ID, to the active
  superusers with an email address, or to `ERROR_EMAIL` when you set it.
  The mail goes out through `EMAIL_URL`.
- **In the admin**, as a "Server errors" notification, when the
  notifications app is installed (see [Notifications](../notifications.md)).

The same error, from the same place, is reported once an hour at most, so
an error on every request does not flood your inbox; its notification
counts up instead. Requests for a host that is not allowed, which bots
send, are never reported.

```bash title=".env"
ERRORS=email
ERROR_EMAIL=ops@example.com,admin@example.com
```

`ERRORS=off` turns the reports off; errors are still in the logs. In
development there are no reports: errors show on the page and in the
terminal.

## Disk space

Docker keeps at most five log files of 10 MB for each container, set by
the `logging` entry of every service in `compose.yaml`. The logs of a
container are deleted with it, so a deploy that recreates a container
starts a new log.

## Health checks

Django answers three health checks. Caddy does not route them, so they
are reachable only inside the Compose network:

| Path | Answers 200 when | Used by |
|------|------------------|---------|
| `/healthz` | The process is up. | |
| `/readyz` | The database and the cache are reachable. | The healthcheck of the backend, which the frontend, the worker and Caddy wait for. |
| `/statusz` | As `/readyz`, and the worker and the daily backup are healthy. | `dstack status` |

They answer JSON, `503` when a check fails:

```json
{"status": "ok", "checks": {"database": "ok", "cache": "ok", "worker": "ok", "backup": "ok"}}
```

Each check is `ok`, `error` or `off`:

- **worker**: the worker runs a task every minute that records the time
  in the cache. The check fails when the last one is more than three
  minutes old. `off` without a worker (`TASKS_URL=immediate://`) or with a
  cache per process (`CACHE_URL=locmem://`).
- **backup**: the worker records the time of each daily backup. The check
  fails when the last one is more than 26 hours old, and is `off` until the
  first backup.

The worker's own healthcheck in `compose.yaml` runs
`python manage.py worker_alive`, which fails on the same rule, so
`docker compose ps` shows a worker that stopped running tasks as
`unhealthy`. Its task stays out of the logs.

Superusers see the same checks in the admin: **System** in the user
menu opens a page with each check, when the worker last checked in and
when the last backup ran, and the latest error reports with how often
each happened. The page reloads its data every minute.

On the server, or after `dstack run`:

```bash
dstack status
```

It shows `docker compose ps`, then each check, and exits 1 when one
fails. `dstack manage health` prints the checks only.

### Alerts for missed backups

To hear about a missed backup, create a check that expects a ping every
day, with Healthchecks.io or a push monitor of Uptime Kuma, and set its URL
in `.env` on the server:

```bash title=".env"
BACKUP_PING_URL=https://hc-ping.com/your-check-id
```

The worker requests the URL after each successful daily backup. When the
pings stop, the service alerts you.
