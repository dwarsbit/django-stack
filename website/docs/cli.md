---
sidebar_position: 7
---

# CLI reference

```bash
npx @django-stack/cli <command>
```

## `init`

Creates a project in a new directory.

```bash
npx @django-stack/cli init [directory] [options]
```

| Option | Description |
|--------|-------------|
| `--name <name>` | The project name: lowercase letters, digits and dashes. The default comes from the directory name. |
| `--frontend <frontend>` | The frontend. `astro` is the only one in this release. |
| `--database-url <url>` | Use your own Postgres instead of the bundled one. URLs to other hosts get `sslmode=require` unless they set an `sslmode`. |
| `--local-s3` | Store uploads in a local S3 service in development, the same code path as S3 in production. See [Media and database](./production/media-and-database.md#s3-in-development). |
| `--no-demo-content` | Start with an empty site. |
| `--no-git` | Don't create a git repository with a first commit. |
| `--start` | Run `docker compose up` when the project is created. |
| `-y`, `--yes` | Don't ask; use the defaults for every option that is not given. |

The command refuses a directory that is not empty. When
[uv](https://docs.astral.sh/uv/) is installed, it also locks the backend's
dependencies in `backend/uv.lock`.

## `production`

Writes `.env.production`, the settings for a server, from the project's
`.env`.

```bash
npx @django-stack/cli production [directory] --domain example.com [options]
```

| Option | Description |
|--------|-------------|
| `--domain <domain>` | The domain of the site. Asked for when it is not given. |
| `--email-url <url>` | The SMTP server, such as `smtp+tls://user:password@smtp.example.com:587`. Without it, `EMAIL_URL` gets a placeholder to fill in. |
| `--force` | Replace an existing `.env.production`. |
| `-y`, `--yes` | Don't ask; fail when `--domain` is missing. |

It switches `COMPOSE_PROFILES` to the prod profile, sets `SITE_URL` and
`BACKEND_URL` to `https://<domain>`, turns debug off and generates new
secrets for everything, including the admin password and the bundled
database's password. The local S3 service's values are cleared. It then
prints what is left to fill in and the admin password. The file is readable
only by you. See [Deploy to a server](./production/server.md).

## `doctor`

Checks a project and its running services.

```bash
npx @django-stack/cli doctor [directory]
```

It checks that Docker and Docker Compose v2 are available, that `.env` has
every required value and two different API keys, and, when the project is
running, that the backend is healthy, the site at `SITE_URL` answers, the
read-only key reads the API and the API is closed without a key. With the
prod profile it also checks that `SITE_URL` is `https` and that mail goes to
an SMTP server. It exits with status 1
when a check fails.

## `secret`

Prints a random URL-safe secret, for example to rotate a value in `.env`.

```bash
npx @django-stack/cli secret [bytes]
```

The default is 32 bytes.
