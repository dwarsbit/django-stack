---
sidebar_position: 2.7
---

# 🚆 Railway

[Railway](https://railway.com/) runs services from a GitHub repository or
a Docker image. It has no Docker Compose, so the CLI turns the production
services of `compose.yaml` into Railway services in one Railway project.
Railway builds the backend and the frontend from their directories in your
repository and deploys them again on every push to the branch.

:::note
This setup follows Railway's API documentation; the continuous integration
of DjangoStack tests the [server setup](./server.md), not Railway itself.
:::

## How the project runs on Railway

Each service runs on its own and reaches the others on Railway's private
network, at `<service>.railway.internal`. The CLI points every `db:5432`,
`backend:8000` and `frontend:3000` in the variables and in the `Caddyfile`
at those names. Railway's edge holds the certificate for the domain and
sends the site's traffic to Caddy on port 80, which routes `/admin`, `/api`
and `/static` to Django and the rest to the frontend, as on a server.

| Service | On Railway |
|---------|------------|
| `proxy` | Caddy from Docker Hub. Railway has no bind mounts, so the `Caddyfile` is in the variable `DSTACK_FILE_CADDYFILE`, and the start command writes it before Caddy starts. The only service with a domain. |
| `backend`, `worker` | Built by Railway from `backend/` with its `Dockerfile`. The worker runs `python manage.py run_huey`. |
| `frontend` | Built by Railway from `frontend/` with its `Dockerfile`. |
| `db` | Railway's Postgres image, `ghcr.io/railwayapp-templates/postgres-ssl`, the one its Postgres template runs, with a volume at `/var/lib/postgresql/data`. |
| `cache`, `umami` | From Docker Hub, with the `valkey` and `analytics` profiles only. |

Railway differs from a server in these ways:

- **Uploads in S3.** A Railway volume belongs to one service, and the
  backend, the worker and Caddy all need the uploads, so `setup` refuses
  to run without `S3_BUCKET`. See [Media and database](./media-and-database.md).
- **Backups in S3.** The worker has no volume. Set `BACKUP_S3_BUCKET`, so
  the daily backup is kept. See [Backups](./backups.md).
- **The last stage of each `Dockerfile`.** Railway builds the last stage,
  so `prod` stays the last stage of `backend/Dockerfile` and
  `frontend/Dockerfile`, and the files have no BuildKit cache mounts
  (`RUN --mount=type=cache`), which Railway rejects.
- **No container hardening from `compose.yaml`.** `read_only`, `cap_drop`,
  `security_opt` and memory limits are not applied, and the CLI says so.

## Deploy with the CLI

You need a Railway account, the project in a GitHub
repository and an S3 bucket for uploads and backups.

1. Create a token at
   [railway.com/account/tokens](https://railway.com/account/tokens): an
   account token, or a token of the workspace to deploy to.
2. Connect your GitHub account in Railway and give the Railway GitHub App
   access to the repository, so Railway can build it.
3. Write the settings for the domain, with S3:

   ```bash
   dstack production --domain example.com \
     --email-url smtp+tls://user:password@smtp.example.com:587
   ```

   Then fill in `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
   `S3_ENDPOINT_URL` and `BACKUP_S3_BUCKET` in `.env.production`.
4. Push your commits: Railway builds the branch on GitHub.
5. Set up the project. It asks for the token, creates a Railway project
   with the services, gives each its variables, creates the database
   volume, connects the services to the repository, which starts the first
   deploy, adds the domain to the `proxy` service and prints the DNS
   record to add:

   ```bash
   dstack deploy setup --provider railway
   ```

6. Add the DNS record it prints, usually a `CNAME` from `example.com` to a
   `up.railway.app` address. Railway requests the certificate once the
   record is there.

After that, Railway deploys every push to the branch by itself: the
backend and the worker when `backend/` changes, the frontend when
`frontend/` changes. `dstack deploy` starts a deploy of the services built
from the repository without a push, and follows it:

```bash
dstack deploy
```

`dstack deploy status` and `dstack deploy logs` show a deploy of all the
built services together: it failed when one of them failed, and the log
has a line prefix per service. `dstack deploy rollback` rolls every built
service back to the deploy before the running one, or to the deploy you
name. `--force` has no effect: Railway has no rebuild without cache in its
API.

| Option of `deploy setup` | Description |
|--------------------------|-------------|
| `--workspace <workspace>` | The Railway workspace, by name or id. Asked for when the token sees several. |
| `--project <project>` | An existing Railway project without these services, by name or id. Default: a new project named after the project. |
| `--environment <name>` | The Railway environment. Default: `production`, created when it does not exist. |
| `--branch <branch>` | The branch Railway builds and deploys on push. Default: the current branch. |

## Variables

`setup` adds these to the variables of `.env.production`:

```bash
CADDY_ADDRESS=:80
# Railway's edge has no fixed address range; only it and the project's
# services reach Caddy.
TRUSTED_PROXIES=0.0.0.0/0 ::/0
NUM_PROXIES=2
```

`NUM_PROXIES=2` tells Django that two proxies forward each request,
Railway's edge and Caddy, so it sees the client's address and the `https`
scheme.

Each service gets the variables Compose gives it, so the frontend still
gets only the read-only key, and `PORT` with the port it listens on, where
Railway sends its health checks and the domain's traffic. After setup,
Railway keeps the variables: change them in Railway, or change
`.env.production` and run `dstack deploy env push`. Railway then deploys the
services whose variables changed.

## Changes to compose.yaml

`setup` creates the services from `compose.yaml`. When you add or rename a
service, add it in Railway's dashboard, or run
`dstack deploy setup --provider railway --force` to create a new project.
The new project starts with an empty database: restore the last backup into
it (see [Backups](./backups.md)), then delete the old project in Railway.
