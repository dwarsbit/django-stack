---
sidebar_position: 4.5
---

# 📜 Logs

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

## Disk space

Docker keeps at most five log files of 10 MB for each container, set by
the `logging` entry of every service in `compose.yaml`. The logs of a
container are deleted with it, so a deploy that recreates a container
starts a new log.
