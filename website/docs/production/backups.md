---
sidebar_position: 4
---

# 💾 Backups

The `backup` service of the `prod` profile backs up the database every day
with `pg_dump`. It keeps the newest backups in the `backups` volume and,
when you give it a bucket, a copy off the server.

Media is not in the database backup. In S3 it is as safe as the bucket:
turn on the bucket's versioning to undo deletes. On the server's disk, back
up the `media` volume with your provider's server backups or snapshots.

## Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_TIME` | `03:00` | The time of the daily backup, in UTC. |
| `BACKUP_KEEP` | `14` | How many backups to keep, locally and in the bucket. Older ones are deleted after each backup. |
| `BACKUP_S3_BUCKET` | | A private bucket for a copy of each backup. |
| `BACKUP_S3_PREFIX` | `backups/` | The folder in the bucket. |
| `BACKUP_S3_ENDPOINT_URL`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | the `S3_*` values | The bucket's service and key, when they differ from the media bucket's. |

:::warning
Never use the public media bucket for backups: anyone could download your
database. Use a separate bucket that is not public.
:::

A backup is a `pg_dump` custom-format file named
`<project>-<UTC time>.dump`, such as `my-site-20261104T030000Z.dump`.

## Back up now

```bash
docker compose exec backup python manage.py backup_database
docker compose exec backup python manage.py backup_database --list
```

`--list` shows the backups in the volume (`local`) and in the bucket
(`bucket`). `--keep N` keeps N backups instead of `BACKUP_KEEP`.

To copy a backup to your machine:

```bash
docker compose cp backup:/app/backups/my-site-20261104T030000Z.dump .
```

## Restore

```bash
docker compose exec backup python manage.py restore_database my-site-20261104T030000Z.dump
```

It asks before it starts; `--yes` skips the question. The restore replaces
every table in the dump with its content from the backup, in one
transaction: when it fails, the database is as it was. Content saved since
the backup is lost, so make a backup first when in doubt.

The backup can be:

- a name from `--list`: from the volume, or downloaded from the bucket when
  it is only there,
- a path in the container, such as a file you copied in with
  `docker compose cp my.dump backup:/app/backups/`.

After a restore, restart the backend and the frontend, so no cached page
shows the newer content:

```bash
docker compose restart backend-prod worker-prod frontend-prod
```

## Move to another server or database

1. Back up on the old server and copy the backup to your machine.
2. Start the project on the new server, or with the new `DATABASE_URL`.
3. Copy the backup in and restore it there.

Media on disk moves with the `media` volume: copy
`/var/lib/docker/volumes/<project>_media/_data` with `rsync`, or use S3.

## Without the bundled services

`backup_database` and `restore_database` work with any Postgres in
`DATABASE_URL`, including a managed one, as long as `pg_dump` and
`pg_restore` (the Postgres client) are installed. The backend image has
them for Postgres 17; `pg_dump` refuses a server of a newer major version,
so for Postgres 18 install its client in `backend/Dockerfile`. Your provider's own backups are still the first line for a
managed database; these are a copy you control.
