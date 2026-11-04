#!/bin/sh
# Runs before the backend, worker and backup commands.
#
# DJANGO_MIGRATE=1 (the backend service): migrate the database, create the
# first admin user and, with SEED_DEMO_CONTENT=1, add demo content to an
# empty site. DJANGO_CHECK_DEPLOY=1 (production): stop when Django's deploy
# checks find an error. S3_CREATE_BUCKET=1 (the development S3 service):
# create the media bucket.
set -eu

python manage.py wait_for_db

if [ "${DJANGO_MIGRATE:-0}" = "1" ]; then
  if [ "${DJANGO_CHECK_DEPLOY:-0}" = "1" ]; then
    python manage.py check --deploy --fail-level ERROR
  fi
  if [ "${S3_CREATE_BUCKET:-0}" = "1" ]; then
    python manage.py create_bucket
  fi
  python manage.py migrate --noinput
  python manage.py create_admin
  if [ "${SEED_DEMO_CONTENT:-0}" = "1" ]; then
    python manage.py seed_content --if-empty
  fi
fi

exec "$@"
