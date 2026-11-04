#!/bin/sh
# Runs before the backend and worker commands. With DJANGO_MIGRATE=1 (the
# backend service), it migrates the database, creates the first admin user
# and, with SEED_DEMO_CONTENT=1, adds demo content to an empty site.
set -eu

python manage.py wait_for_db

if [ "${DJANGO_MIGRATE:-0}" = "1" ]; then
  python manage.py migrate --noinput
  python manage.py create_admin
  if [ "${SEED_DEMO_CONTENT:-0}" = "1" ]; then
    python manage.py seed_content --if-empty
  fi
fi

exec "$@"
