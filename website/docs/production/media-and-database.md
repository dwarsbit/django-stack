---
sidebar_position: 3
---

# 🗄️ Media and database

By default a project keeps uploads in the `media` volume and the database in
the bundled Postgres, both on the server. Both can move off the server: the
media to any S3-compatible storage, the database to a managed Postgres. The
server then holds no data, and can be replaced at any time.

## Media in S3

Any S3-compatible service works: AWS S3, Cloudflare R2, Hetzner Object
Storage, Scaleway, DigitalOcean Spaces, or your own.

`init` asks where uploads go in production, but not for credentials. With
S3 (`--media s3`), `dstack production` and
[`dstack settings`](../cli.md#settings) ask for the `S3_*` variables.

1. Create a bucket whose files are publicly readable, and an access key
   that may write to it.
2. Set the `S3_*` variables in `.env`:

   ```bash
   S3_BUCKET=example-media
   S3_ENDPOINT_URL=https://fsn1.your-objectstorage.com   # empty for AWS
   S3_REGION=fsn1
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   # Where the files are public, when that is not the endpoint: a CDN, a
   # custom domain or the bucket's public URL.
   S3_PUBLIC_URL=https://media.example.com
   ```

3. Restart: `dstack run`.

Uploads go to the bucket from then on, and image URLs point to
`S3_PUBLIC_URL`. The frontend's Content Security Policy allows images and
video from that origin. Files already uploaded stay in the `media` volume;
copy them to the bucket with any S3 tool, such as
`aws s3 sync`, from the volume's directory.

| Variable | Description |
|----------|-------------|
| `S3_BUCKET` | The bucket. Setting it switches uploads to S3. |
| `S3_ENDPOINT_URL` | The service's endpoint; empty for AWS. |
| `S3_REGION` | The region of the bucket. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | The access key. |
| `S3_PUBLIC_URL` | The public base URL of the files, when it is not the endpoint. |
| `S3_CUSTOM_DOMAIN` | A host name the files are served from over HTTPS; `S3_PUBLIC_URL` replaces it. |
| `S3_QUERYSTRING_AUTH` | `1` for signed, expiring URLs on a private bucket. |
| `S3_CREATE_BUCKET` | `1` creates the bucket on start when it does not exist. For the local S3 service. |

### S3 in development

`init --storage s3` adds a local S3 service ([SeaweedFS](https://github.com/seaweedfs/seaweedfs))
to development, so uploads take the same code path as in production. Its
files are public at `http://localhost:8333/media/`. To add it to an existing
project, add `s3` to `COMPOSE_PROFILES` and set the values in the comment
above `S3_BUCKET` in `.env`.

The `production` command clears the local service's values, so you set your
real bucket in `.env.production`.

## An external database

A managed Postgres (from your provider, Neon, Supabase, or another) is
backed up and updated for you. Postgres 15 or newer works; 17 is the
version DjangoStack tests with.

Development keeps the bundled Postgres, so your local data never touches
the server's.

1. Run `dstack production` and choose **Your own Postgres**. Enter the
   host, port, database name, user and password, or a `postgres://` URL.
   Separate values are URL-encoded for you; in a URL, encode special
   characters in the password yourself (`@` as `%40`, `/` as `%2F`).
   `.env.production` gets it as `DATABASE_URL`, with `sslmode=require` for
   a server on another host, and without `db` in `COMPOSE_PROFILES`.

   Without a terminal, pass it with `--database-url`, or set
   `PRODUCTION_DATABASE_URL` in `.env` (`init --database-url` does):

   ```bash
   PRODUCTION_DATABASE_URL=postgres://user:password@db.example.com:5432/app?sslmode=require
   ```

2. Deploy. The backend migrates the new database.

To switch a server that already runs, set `DATABASE_URL` in its `.env` and
remove `db` from `COMPOSE_PROFILES` (`COMPOSE_PROFILES=prod`, or
`prod,analytics` with Umami). With Umami, also set `UMAMI_DATABASE_URL` to
the same URL with `&uselibpqcompat=true&schema=umami` at the end; running
`dstack production` again does both for you. `dstack run`
on your machine keeps the bundled Postgres either way.

To move existing content to the new database, back up the old one and
restore the backup into the new one: see [Backups](./backups.md).
