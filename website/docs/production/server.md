---
sidebar_position: 1
---

# 🖥️ Deploy to a server

A project runs in production with the same `compose.yaml` as in
development. The `prod` profile starts production images of the backend and
the frontend behind [Caddy](https://caddyserver.com/), which gets and renews
the HTTPS certificate by itself, plus a worker that also makes the daily
backups. This
page deploys to one Linux server (a VPS) of your own.

```text
                  ┌─────────────────────── server ───────────────────────┐
browser ─ 443 ──▶ │ proxy (Caddy) ─┬─ /admin /api /static ─▶ backend-prod │
                  │                ├─ /media ─▶ media volume              │
                  │                └─ everything else ─▶ frontend-prod    │
                  │ worker-prod  cache  db (or an external one)           │
                  └───────────────────────────────────────────────────────┘
```

## What you need

- A server with Docker Engine and the Compose plugin, Node.js 22 or later
  with `dstack` installed (`npm i -g @django-stack/cli`), at
  least 2 GB of memory, and ports 80 and 443 open. Any provider works; one with 2 vCPUs
  and 4 GB is comfortable for a site with a database on the same server.
- A domain with a DNS `A` (and `AAAA`) record pointing at the server. Caddy
  needs it before the first start to get the certificate.
- An SMTP server for the mail the site sends (password resets, form
  notifications), such as your provider's or a transactional mail service.

## Deploy with the CLI

`dstack deploy` sets up the server and deploys to it over SSH, with your
own SSH keys and `~/.ssh/config`; it stores no keys. It uploads your last
commit, so the server needs no access to your git repository.

1. Make sure `ssh deploy@example.com` logs in without a password and that
   the user may run `docker` (`sudo usermod -aG docker deploy`). Connect
   once by hand first, so the server's host key is in `known_hosts`.
2. Write the production settings, as in step 1 below:

   ```bash
   dstack production --domain example.com \
     --email-url smtp+tls://user:password@smtp.example.com:587
   ```

3. Set up the server. It checks Docker and the Compose plugin, creates the
   project directory and uploads `.env.production` as its `.env`:

   ```bash
   dstack deploy setup --provider ssh --url deploy@example.com
   ```

   The directory is `/srv/<project>` by default. When the user cannot
   create it, setup prints the `sudo` command that does, or pass a
   directory the user owns with `--path /home/deploy/your-site`.

4. Commit your changes and deploy:

   ```bash
   dstack deploy
   ```

Each deploy is a new release on the server, built and started with
`docker compose up`. The deploy goes on when your connection drops; follow
it with `dstack deploy status --watch`. The server keeps the last five
releases, and `dstack deploy rollback` starts the one before the running
one again. A rollback does not undo database migrations.

```text
/srv/your-site/
  shared/.env          .env.production, kept on the server
  releases/<deploy>/   one per deploy, the last five
  current              the release that runs
  deploys/             the status and log of each deploy
```

After setup the server keeps the variables. To change them, edit
`.env.production` and run `dstack deploy env push`; they apply on the next
deploy. The [CLI reference](../cli.md#deploy) lists every command.

The rest of this page sets up the same server by hand.

## 1. Write the production settings

On your machine, in the project directory:

```bash
dstack production --domain example.com \
  --email-url smtp+tls://user:password@smtp.example.com:587
```

It writes `.env.production` from your `.env` with:

- `COMPOSE_PROFILES=prod,db`, or `prod` with `DATABASE_URL` set to
  `PRODUCTION_DATABASE_URL` when `.env` has an external Postgres,
- `SITE_URL` and `BACKEND_URL` set to `https://example.com`,
- debug off and new secrets for everything: the secret key, the API keys,
  the preview and revalidation secrets, the admin password and, for the
  bundled database, the database password,
- your `EMAIL_URL` and a `DEFAULT_FROM_EMAIL` on the domain,
- `COMPOSE_FILE=compose.yaml:compose.ports.yaml`, so `docker compose`
  also loads `compose.ports.yaml`, which publishes Caddy's ports 80 and
  443. `compose.yaml` publishes no ports, so that several projects can
  share a server behind a platform's proxy; without this line the site is
  not reachable.

It then offers to ask for the settings it cannot know: `ADMIN_EMAIL`, the
SMTP server when you did not pass `--email-url`, and the `S3_*` variables
when uploads go to S3. It prints what is left to do and the admin password.
Run `dstack settings` to fill in or change these later. Keep the file out
of git: it holds the secrets of the live site.

## 2. Copy the project to the server

The server needs the project's files and `.env.production` as its `.env`.
With git:

```bash
ssh deploy@example.com
git clone https://github.com/you/your-site.git /srv/your-site
exit
scp .env.production deploy@example.com:/srv/your-site/.env
```

## 3. Start it

```bash
ssh deploy@example.com
cd /srv/your-site
dstack run
```

`run` builds the images, starts the services in the background and waits
until they are healthy. The first start builds the images, migrates the database, creates the admin
user and gets the certificate. It takes a few minutes. Then check it:

```bash
dstack check       # the settings, the deploy checks and the running site
dstack logs proxy  # "certificate obtained successfully"
```

Open `https://example.com/admin/` and log in as `admin` with the password
from step 1.

## Updates

```bash
cd /srv/your-site
git pull
dstack run
```

The backend migrates the database before it starts. Compose replaces the
containers whose image or settings changed, so the site is away for the
seconds the new backend takes to become healthy. To build the images elsewhere, see
[Deploy with GitHub Actions](#deploy-with-github-actions).

## Deploy with GitHub Actions

A project has an optional workflow, `.github/workflows/deploy.yml`. It
builds the production images on GitHub, pushes them to the GitHub Container
Registry and starts them on your server over SSH, so the server never
builds. Set it up once:

1. Do steps 1 to 3 above, so the server has the project directory and its
   `.env`.
2. Make an SSH key for deploys and allow it on the server:

   ```bash
   ssh-keygen -t ed25519 -f deploy_key -N ""
   ssh-copy-id -i deploy_key.pub deploy@example.com
   ```

3. Add these repository secrets (Settings, Secrets and variables, Actions):

   | Secret | Value |
   |--------|-------|
   | `DEPLOY_HOST` | The server, such as `example.com`. |
   | `DEPLOY_USER` | The user, such as `deploy`. It must be allowed to run `docker`. |
   | `DEPLOY_SSH_KEY` | The contents of `deploy_key`. |
   | `DEPLOY_PATH` | The project directory, such as `/srv/your-site`. |
   | `DEPLOY_KNOWN_HOSTS` | The output of `ssh-keyscan example.com`. |

4. Run the workflow from the Actions tab. To deploy every push to `main`,
   add `push: { branches: [main] }` under `on:` in the workflow.

The workflow copies `compose.yaml`, `compose.ports.yaml` and
`caddy/Caddyfile` to the server; the server keeps its own `.env`, with
`COMPOSE_FILE` from `dstack production`. The images are named after the commit, so a
rollback is running the workflow again on an older commit.

## Resources

Each production service has a memory limit, so one runaway process cannot
take down the server:

| Service | Limit |
|---------|-------|
| `backend-prod` (3 workers) | 768 MB |
| `worker-prod` (also the daily backup) | 512 MB |
| `frontend-prod` | 512 MB |
| `db` | 1 GB |
| `proxy`, `cache` | 256 MB each |

Change them under `deploy.resources.limits` in `compose.yaml`. With more
memory, add backend workers with `--workers` in `backend/Dockerfile`.

### Database connections

The bundled Postgres accepts 100 connections. The backend runs on ASGI,
where Django keeps no persistent connections: each request opens one and
closes it when it ends, so the backend holds at most one per request in
progress. Umami's pool holds up to 10 more. To reuse connections instead
of opening one per request, set `DATABASE_POOL=1` in `.env`: each backend
worker and the task worker then keep a pool of at most
`DATABASE_POOL_SIZE` (4) connections, and requests wait for a free one.
More workers need more connections, so keep workers times the pool size,
plus Umami's 10, under 100.

## Troubleshooting

- **No certificate**: the DNS record must point at the server and ports 80
  and 443 must be open. `dstack logs proxy` shows why Let's Encrypt
  refused. Caddy retries by itself.
- **The backend does not start**: `dstack logs backend-prod`. The
  start runs `check --deploy` and stops on an error, such as debug on or an
  `http://` `SITE_URL`.
- **Mail is not sent**: `EMAIL_URL` must be your SMTP server; Mailpit only
  runs in development. `doctor` checks it.
