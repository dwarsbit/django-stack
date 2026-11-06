---
sidebar_position: 2.5
---

# 🐇 Bunny Magic Containers

[Bunny Magic Containers](https://bunny.net/magic-containers/) runs Docker
images on bunny.net, behind its CDN. It has no Docker Compose, so the CLI
turns the production services of `compose.yaml` into one Magic Containers
app: it builds the images of your last commit, pushes them to Bunny
Container Registry and creates the app with one container per service.

:::note
This setup follows Bunny's API documentation; the continuous integration of
DjangoStack tests the [server setup](./server.md), not Bunny itself.
:::

## How the project runs on Bunny

All containers of a Magic Containers app run together in one pod. They
reach each other on `localhost`, so the CLI points every `db:5432`,
`cache:6379`, `backend:8000` and `frontend:3000` in the variables and in the
`Caddyfile` at `127.0.0.1`. One CDN endpoint sends the site's traffic to
Caddy on port 80, which routes `/admin`, `/api` and `/static` to Django and
the rest to the frontend, as on a server. Bunny's CDN holds the certificate
for the domain.

| Service | On Bunny |
|---------|----------|
| `proxy` | Caddy with the project's `Caddyfile` copied into the image, the app's only public endpoint |
| `backend-prod`, `worker-prod`, `frontend-prod` | The production images, built for `linux/amd64` and pushed to Bunny Container Registry |
| `db` | Postgres from Docker Hub with the `pgdata` volume |
| `cache` | Valkey from Docker Hub, without a volume |

Bunny differs from a server in these ways:

- **One instance in one region.** Postgres and Valkey run in the pod, so
  the app is not replicated. Use an external Postgres through
  `DATABASE_URL` to keep the database out of the pod.
- **A short outage on each deploy.** A pod with a volume stops before the
  new one starts, so the site is down for the time the new containers take
  to start, usually under a minute.
- **Uploads in S3.** Bunny volumes belong to one pod and are not backed
  up, so `setup` refuses to run without `S3_BUCKET`. See
  [Media and database](./media-and-database.md).
- **Backups in S3.** A Bunny volume is lost when its disk fails. Set
  `BACKUP_S3_BUCKET`, so the daily backup leaves the pod. See
  [Backups](./backups.md).
- **No container hardening from `compose.yaml`.** Bunny runs each app in a
  gVisor sandbox; `read_only`, `cap_drop`, `security_opt` and memory limits
  are not applied, and the CLI says so.

## Deploy with the CLI

You need a bunny.net account with a payment card, Docker with `buildx` on
your machine and an S3 bucket for uploads and backups.

1. Copy the account API key from
   [dash.bunny.net/account/api-key](https://dash.bunny.net/account/api-key).
   The same key logs in to Bunny Container Registry.
2. Write the settings for the domain, with S3:

   ```bash
   dstack production --domain example.com \
     --email-url smtp+tls://user:password@smtp.example.com:587
   ```

   Then fill in `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
   `S3_ENDPOINT_URL` and `BACKUP_S3_BUCKET` in `.env.production`.
3. Commit your work: the CLI builds the last commit.
4. Set up the app. It asks for the API key and the region, builds and
   pushes the images, creates the app, adds the domain to the app's CDN
   pull zone and prints the DNS record to add:

   ```bash
   dstack deploy setup --provider bunny
   ```

5. Add the DNS record it prints, a `CNAME` from `example.com` to the pull
   zone's `b-cdn.net` address. An apex domain such as `example.com` needs
   [Bunny DNS](https://bunny.net/dns/), which flattens the `CNAME`; with
   another DNS provider, use `www.example.com` and redirect the apex to it.
   Bunny requests the certificate once the record is there; each
   `dstack deploy` asks again until it has one, and `dstack deploy status`
   shows whether it is active.

After that, each deploy builds and pushes the images of your last commit,
tagged with the commit, and points the containers at the new tag:

```bash
dstack deploy
```

`dstack deploy rollback` points them back at the images of an earlier
deploy. The CLI keeps the records of the last 20 deploys in
`.dstack/deploys/`, on your machine. Bunny's container logs are in its
dashboard, under the app; `dstack deploy status` links to it.

| Option of `deploy setup` | Description |
|--------------------------|-------------|
| `--region <region>` | The region of the app, such as `DE`. Default: the one Bunny picks as closest. |
| `--volume-size <GB>` | The size of the database volume, from 1 to 100 GB. Default: 10. It can grow later, not shrink. |
| `--account <id>` | The account id, the namespace in Bunny Container Registry. Asked for when Bunny does not list it. |

## Variables

`setup` adds these to the variables of `.env.production`:

```bash
CADDY_ADDRESS=:80
NUM_PROXIES=2
# Bunny's edge servers, from https://api.bunny.net/system/edgeserverlist
TRUSTED_PROXIES=...
```

`NUM_PROXIES=2` tells Django that two proxies forward each request, Bunny's
CDN and Caddy, so it sees the client's address and the `https` scheme.
The CDN never caches `/admin`, `/api` and `/_a`, the analytics tracker.

Each container gets the variables Compose gives its service, so the
frontend still gets only the read-only key. After setup, Bunny keeps the
variables: change `.env.production` and run `dstack deploy env push`, which
also reads the edge server list again.

## Changes to compose.yaml

`setup` creates the app from the services in `compose.yaml`. When you add,
rename or remove a service, `dstack deploy` stops with a message; run
`dstack deploy setup --provider bunny --force` to create a new app. The
new app starts with an empty database: restore the last backup into it
(see [Backups](./backups.md)), then delete the old app in Bunny's
dashboard.
