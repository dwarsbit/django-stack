---
sidebar_position: 6
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
| `--no-demo-content` | Start with an empty site. |
| `--no-git` | Don't create a git repository with a first commit. |
| `--start` | Run `docker compose up` when the project is created. |
| `-y`, `--yes` | Don't ask; use the defaults for every option that is not given. |

The command refuses a directory that is not empty. When
[uv](https://docs.astral.sh/uv/) is installed, it also locks the backend's
dependencies in `backend/uv.lock`.

## `doctor`

Checks a project and its running services.

```bash
npx @django-stack/cli doctor [directory]
```

It checks that Docker and Docker Compose v2 are available, that `.env` has
every required value and two different API keys, and, when the project is
running, that the backend is ready, the frontend answers, the read-only key
reads the API and the API is closed without a key. It exits with status 1
when a check fails.

## `secret`

Prints a random URL-safe secret, for example to rotate a value in `.env`.

```bash
npx @django-stack/cli secret [bytes]
```

The default is 32 bytes.
