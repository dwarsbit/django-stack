---
sidebar_position: 4
---

# 💾 Backups

The `backup` service of the `prod` profile backs up the database every day
with `pg_dump` and, when uploads are on the server's disk, the `media`
volume as an archive. It keeps the newest backups in the `backups` volume
and, when you give it a bucket, a copy off the server.

Store media in S3 when you can (see
[Media and database](./media-and-database.md)): the bucket keeps the files
off the server, and its versioning undoes deletes. Media in S3 is not in
these backups. The media archive is for uploads on the server's disk, and
each archive holds every file, so it grows with the media.

## Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_TIME` | `03:00` | The time of the daily backup, in UTC. |
| `BACKUP_KEEP` | `14` | How many backups to keep, locally and in the bucket, of the database and of the media each. Older ones are deleted after each backup. |
| `BACKUP_MEDIA` | `1` | Archive the `media` volume with each database backup. Ignored when uploads go to S3. Set `0` to back up the database only. |
| `BACKUP_S3_BUCKET` | | A private bucket for a copy of each backup. |
| `BACKUP_S3_PREFIX` | `backups/` | The folder in the bucket. |
| `BACKUP_S3_ENDPOINT_URL`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | the `S3_*` values | The bucket's service and key, when they differ from the media bucket's. |

:::warning
Never use the public media bucket for backups: anyone could download your
database. Use a separate bucket that is not public.
:::

A database backup is a `pg_dump` custom-format file named
`<project>-<UTC time>.dump`, such as `my-site-20261104T030000Z.dump`. The
media archive made with it has the same name with `.media.tar.gz`, such as
`my-site-20261104T030000Z.media.tar.gz`.

## Back up now

```bash
dstack backup
dstack backup --list
```

These run `backup_database` in the `backup` service, which you can also run
yourself: `docker compose exec backup python manage.py backup_database`.
`--list` shows the backups in the volume (`local`) and in the bucket
(`bucket`). `--no-media` backs up the database only, and `--keep N` (on
`backup_database`) keeps N backups instead of `BACKUP_KEEP`.

To copy a backup to your machine:

```bash
docker compose cp backup:/app/backups/my-site-20261104T030000Z.dump .
```

## Restore

```bash
dstack restore my-site-20261104T030000Z.dump --media
```

`--media` also restores the media archive made with that dump; without it,
only the database is restored. A `.media.tar.gz` name restores only the
media. The commands behind it are `restore_database <name> [--media]` and
`restore_media <name>`.

It asks before it starts; `--yes` skips the question. The restore replaces
every table in the dump with its content from the backup, in one
transaction: when it fails, the database is as it was. Content saved since
the backup is lost, so make a backup first when in doubt. The media restore
unpacks the archive first and only then replaces the files in the `media`
volume, so a broken archive changes nothing; files uploaded since the
backup are deleted.

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

1. Back up on the old server with `dstack backup`.
2. Start the project on the new server, or with the new `DATABASE_URL`, with
   the same `BACKUP_S3_BUCKET`. Without a bucket, copy the `.dump` and the
   `.media.tar.gz` into the new server's `backups` volume.
3. Restore there with `dstack restore <name> --media`.

## Without the bundled services

`backup_database` and `restore_database` work with any Postgres in
`DATABASE_URL`, including a managed one, as long as `pg_dump` and
`pg_restore` (the Postgres client) are installed. The backend image has
them for Postgres 17; `pg_dump` refuses a server of a newer major version,
so for Postgres 18 install its client in `backend/Dockerfile`. Your provider's own backups are still the first line for a
managed database; these are a copy you control.
