---
sidebar_position: 7
---

# CLI reference

```bash
npx @django-stack/cli <command>
```

`npx @django-stack/cli help <command>` or `<command> --help` lists the
options of a command. Every prompt has a flag, so each command also runs in
scripts and CI.

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
| `--time-zone <zone>` | The time zone of the backend, an IANA name such as `Europe/Amsterdam`. The prompt suggests this computer's zone and filters as you type. The default with `--yes` is `UTC`. |
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

## `completion`

Prints a script that completes commands, options and their values when you
press Tab. It needs the CLI on your `PATH`, for example after
`npm install -g @django-stack/cli`.

```bash
django-stack completion zsh|bash|fish|powershell
```

Add it to your shell's startup file:

| Shell | Line |
|-------|------|
| zsh, in `~/.zshrc` | `source <(django-stack completion zsh)` |
| bash, in `~/.bashrc` | `source <(django-stack completion bash)` |
| fish, in `~/.config/fish/config.fish` | `django-stack completion fish \| source` |
| PowerShell, in `$PROFILE` | `django-stack completion powershell \| Out-String \| Invoke-Expression` |

## Update check

Each command checks npm, at most once a day, for a newer version of the CLI
and shows a notice with the command to update when there is one. The check
runs while the command runs and never makes it fail. It is cached in
`~/.cache/django-stack/update-check.json` (or under `$XDG_CACHE_HOME`).

It is skipped in CI, when the output is not a terminal, and for `secret` and
`completion`. Turn it off with `--no-update-check` or by setting
`DJANGO_STACK_NO_UPDATE_CHECK=1` (`NO_UPDATE_NOTIFIER=1` works too).

With `npx`, ask for the latest version to skip a cached older copy:

```bash
npx @django-stack/cli@latest init
```
