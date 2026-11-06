# syntax=docker/dockerfile:1

# The backend image: Django, the API and the admin. The `dev` target runs
# the development server with the source mounted; `prod` runs Gunicorn.
FROM python:3.13-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/venv \
    PATH="/venv/bin:$PATH"
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /bin/uv
# The Postgres client, for the backups (pg_dump and pg_restore).
RUN apt-get update \
    && apt-get install --yes --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd --system app && useradd --system --gid app --home-dir /app app
WORKDIR /app

FROM base AS deps
COPY pyproject.toml uv.lock* ./
COPY vendor/ vendor/
# No BuildKit cache mounts: Railway rejects them, and the layer is cached anyway.
RUN uv sync --no-dev --no-install-project --no-cache

# Development runs as root, so files the container writes into the mounted
# source (such as new migrations) work on every host. Production does not.
# The entrypoint runs with sh, so it works without the executable bit (the
# mounted source keeps the host's file modes).
FROM deps AS dev
RUN uv sync --no-install-project --no-cache
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

FROM base AS prod
COPY --from=deps /venv /venv
# The code is owned by root: the app user can read it, not change it.
COPY . .
RUN DJANGO_SECRET_KEY=collectstatic-only python manage.py collectstatic --noinput \
    && mkdir -p /app/media /app/backups && chown -R app:app /app/media /app/backups
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/readyz', timeout=4)"
ENTRYPOINT ["sh", "/app/entrypoint.sh"]
CMD ["gunicorn", "config.asgi:application", "--worker-class", "uvicorn_worker.UvicornWorker", "--bind", "0.0.0.0:8000", "--workers", "3", "--no-control-socket"]
