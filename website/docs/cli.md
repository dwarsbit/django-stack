---
sidebar_position: 7
---

# ⌨️ CLI reference

```bash
npx @django-stack/cli <command>
dstack <command>            # once it is installed
```

`dstack help <command>` or `<command> --help` lists the options of a
command. Every prompt has a flag, so each command also runs in scripts and
CI.

## Install `dstack`

The first time you run the CLI with `npx`, `pnpm dlx` or `bunx`, it asks
when the command is done whether to install `dstack` globally, with the
package manager you ran it with. After that, `dstack init` does the same as
`npx @django-stack/cli init`. You can also install it yourself:

```bash
npm install --global @django-stack/cli
```

The CLI asks only once and remembers the answer in
`~/.config/django-stack/config.json` (or under `$XDG_CONFIG_HOME`). It does
not ask when `dstack` is already installed, in CI, when the input or output
is not a terminal, or with `--yes`. Turn it off with `--no-install-prompt`
or `DJANGO_STACK_NO_INSTALL_PROMPT=1`.

When the install fails, the command still succeeds and the CLI prints the
reason and the command to run yourself. A permission error usually means
npm's global directory belongs to root: give npm a
[directory in your home](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally)
instead of using `sudo`. With pnpm, run `pnpm setup` first.

## `init`

Creates a project in a new directory.

```bash
npx @django-stack/cli init [directory] [options]
```

| Option | Description |
|--------|-------------|
| `--name <name>` | The project name: lowercase letters, digits and dashes. The default comes from the directory name. |
| `--preset <preset>` | Set the stack options below from a preset code or name. See [Presets](#presets). |
| `--database-url <url>` | Use your own Postgres instead of the bundled one. URLs to other hosts get `sslmode=require` unless they set an `sslmode`. |
| `--time-zone <zone>` | The time zone of the backend, an IANA name such as `Europe/Amsterdam`. The prompt suggests this computer's zone and filters as you type. The default with `--yes` is `UTC`. |
| `--no-demo-content` | Start with an empty site. |
| `--no-git` | Don't create a git repository with a first commit. |
| `--start` | Run `docker compose up` when the project is created. |
| `-y`, `--yes` | Don't ask; use the defaults for every option that is not given. |

`init` starts by checking this computer:

- Docker is installed and running, with Docker Compose v2;
- Node.js 22 or later;
- Python 3.12 or later.

A failed check is a warning with the install command for your operating
system: Homebrew on macOS, winget on Windows, and the install scripts on
Linux. Node.js is installed with [fnm](https://github.com/Schniz/fnm) and
Python with [uv](https://docs.astral.sh/uv/). The project is created anyway,
because the project runs in Docker and Node.js and Python are only for
development outside the containers. With `--start`, `init` does not start the
project when Docker is not ready.

### Stack options

Each stack option is asked for, unless a flag or `--preset` sets it. The
first value is the default. Values marked *later* are in the list already,
but this release does not generate them yet: `init` refuses them, and lists
the defaults it does not generate yet when it is done.

| Option | Values |
|--------|--------|
| `--frontend` | `astro`, `next` (later), `headless` (later, just the API and the admin), `templates` (later, Django templates) |
| `--postgres` | `stable` (Postgres 17), `latest` (Postgres 18, later). Ignored with `--database-url`. |
| `--analytics` | `umami` (later, built in), `off` |
| `--tasks` | `huey`, `off` (later) |
| `--cache` | `database` (later), `valkey` (later), `off` (later) |
| `--notifications` | `on` (later, in the admin and by email), `off` |
| `--captcha` | `on` (later, the built-in captcha), `off` |
| `--storage` | `local`, `s3` (a local S3 service in development, the same code path as S3 in production; see [Media and database](./production/media-and-database.md#s3-in-development)) |
| `--package-manager` | `pnpm` (later), `npm`, `bun` (later). Only for a Node frontend. |

### Presets

A preset sets every stack option at once, so you can share a stack or
create the same one again. When `init` is done, it prints the preset of the
project:

```bash
npx @django-stack/cli init my-site --preset a201
```

Flags win over the preset, so `--preset a201 --storage s3` changes only the
storage. There are named presets too:

| Name | Stack |
|------|-------|
| `blog` | Astro with everything on: the defaults. |
| `api` | Headless, without analytics. |
| `minimal` | Astro with analytics, tasks, cache, notifications and captcha off. |

`dstack preset` asks for the stack options and prints the code, and
`dstack preset <code>` shows the stack of a code. A code from a newer
CLI fails with a request to update.

The command refuses a directory that is not empty. When
[uv](https://docs.astral.sh/uv/) is installed, it also locks the backend's
dependencies in `backend/uv.lock`.

## Project commands

These commands run in a project created by `init`, from its directory or
any directory below it. `-C <directory>` (`--dir`) points them at another
project. They need Docker Compose v2.

| Command | What it does |
|---------|--------------|
| `dstack dev` | Starts the development servers in the foreground, with hot reload. Ctrl+C stops them. |
| `dstack run` | Starts the production setup in the background and waits until it is healthy. |
| `dstack stop` | Stops the containers. The database, uploads and backups stay in their volumes. |
| `dstack logs [service...]` | Follows the logs. `--no-follow` prints them and exits, `-n <lines>` shows only the last lines. |
| `dstack check` | Checks the project. See [`check`](#check). |
| `dstack update` | Updates the images and the DjangoStack packages. See [`update`](#update). |
| `dstack config` | Changes the stack options. See [`config`](#config). |
| `dstack manage <command>` | Runs a Django management command in the backend, such as `dstack manage createsuperuser`. |
| `dstack shell` | Opens Django's shell in the backend. |
| `dstack backup` | Backs up the database and, when uploads are on disk, the media now. `--list` lists the backups, `--no-media` skips the media. |
| `dstack restore <backup>` | Restores a backup from `dstack backup --list` over the database. `--media` also restores its media; a `.media.tar.gz` name restores only the media. It asks first; `--yes` doesn't. See [Backups](./production/backups.md). |
| `dstack types` | Generates the frontend's API types in `frontend/src/lib/headless.ts` from the backend's schema. |
| `dstack deploy` | Deploys to a hosting platform and shows the status. See [`deploy`](#deploy). |

`manage`, `shell`, `logs` and `check` use the running containers, and start
a one-off container when the backend is not running.

### `dev` and `run`

`dstack dev` runs the `dev` profile: Django's development server and the
frontend's, with the source mounted from `backend/` and `frontend/`. It is
`docker compose up --build`. `--no-build` skips the build.

`dstack run` runs the `prod` profile: the production images behind Caddy,
as on a server. On a server, where `.env` has the prod profile, it is
`docker compose up -d --build --wait`.

On your computer, `dstack run` tries the production setup without touching
your development data. The first time, it writes `.env.run` from `.env`
with the prod profile, `SITE_URL=https://site.localhost`, mail to the
console and new secrets, and prints the admin password. It runs as its own
Compose project (`<name>-run`), so it has its own database and uploads.
Open https://site.localhost. Caddy signs it with a local certificate
authority of its own, so the browser warns once. Ports 80 and 443 must be
free.

While the local run is up, `logs`, `manage`, `shell`, `check`, `backup` and
`restore` act on it. `dstack stop` stops both. Delete `.env.run` to start
over with new secrets;
`docker compose --env-file .env.run -p <name>-run down --volumes` deletes
its data too.

### `check`

Runs the doctor's checks (see [`doctor`](#doctor)), then in the containers:

- Django's system checks, or the deploy checks with `--fail-level WARNING`
  in the prod profile.
- That the migrations are up to date (`makemigrations --check`).
- Ruff on the backend and `astro check` on the frontend, in development.
- With `--tests`, the backend's and the frontend's tests, in development.

It prints the output of each check that fails and exits with status 1.

### `update`

1. With [uv](https://docs.astral.sh/uv/) installed, upgrades `django-stack`
   in `backend/uv.lock`. `--all` upgrades every backend package.
2. Pulls the newer images of the services (Postgres, Valkey, Caddy and the
   others) and rebuilds the backend and frontend images on fresh base
   images. `--no-cache` rebuilds them from scratch, which also picks up
   newer npm packages within the ranges in `frontend/package.json`.
3. In development, empties the frontend's `node_modules` volume, so the
   next start uses the packages of the new image.
4. Restarts what was running, unless you pass `--no-restart`.

Commit the changed `backend/uv.lock`. On a server, `git pull` first, then
`dstack update`.

### `config`

Changes the stack options of a project: it asks for each option it can
change, or takes the same flags as `init`, such as `--storage s3`. It
updates `.env` and the preset in `package.json`, then asks you to restart.

This release can switch `--storage` between `local` and `s3` in
development. The other options can only be set by `init` until code
generation for them lands; `config` refuses them with the reason.

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

## `deploy`

Puts the project on a hosting platform or a server, deploys it and shows
its status. There are two providers:

- **Coolify** (`--provider coolify`, the default) and **Dokploy**
  (`--provider dokploy`) build the project on their server from the git
  repository, so push your commits before you deploy. See
  [Coolify and Dokploy](./production/platforms.md).
- **A server over SSH** (`--provider ssh`) gets your last commit uploaded
  and runs `docker compose up` there, so commit before you deploy. See
  [Deploy to a server](./production/server.md#deploy-with-the-cli).

```bash
dstack production --domain example.com
dstack deploy setup --url https://coolify.example.com
dstack deploy
```

| Command | What it does |
|---------|--------------|
| `dstack deploy setup` | Creates the project and the application on the platform, sets the domain and uploads the variables. See [`deploy setup`](#deploy-setup). |
| `dstack deploy` | Starts a deploy and follows it until it ends; on a failure it prints the end of the build log. `--force` rebuilds without the cache, `--no-wait` returns once the deploy started. `dstack deploy start` is the same command. |
| `dstack deploy status` | Shows whether the site runs, its domain, and the last deploys. `--watch` follows a running deploy, `-n <count>` lists more deploys. |
| `dstack deploy logs [deployment]` | Prints the build log of a deploy, the latest by default. |
| `dstack deploy rollback [deployment]` | Starts an earlier release again: the one before the running one, or the deploy you name. Servers over SSH only. `--no-wait` returns once it started. |
| `dstack deploy env push` | Replaces the platform's variables with `.env.production`. |
| `dstack deploy login` | Checks an API key and saves it. `setup` asks for one when there is none. Not used for servers over SSH. |
| `dstack deploy logout` | Removes a saved API key. |

`dstack deploy` refuses when the deploy would not include your work: for
Coolify and Dokploy, when your last commit is not on the branch it deploys (push it);
for a server over SSH, when you have uncommitted changes (commit them).
`--no-push-check` deploys anyway.

### `deploy setup`

| Option | Description |
|--------|-------------|
| `--provider <provider>` | `coolify`, `dokploy` or `ssh`. Asked for when it is not given; with `--yes`, `coolify`. |
| `--url <url>` | The platform's address, such as `https://coolify.example.com`, or the server, such as `deploy@example.com` or `deploy@example.com:2222`. |
| `--repository <url>` | The git repository the platform builds. Default: the `origin` remote, as an `https` URL. |
| `--branch <branch>` | The branch to deploy. Default: the current branch. |
| `--server <server>` | The Coolify or Dokploy server, by name or id. Asked for when there are several. For Dokploy, `dokploy` is its own server, the default. |
| `--project <project>` | The Coolify or Dokploy project, by name or id. Default: a new project named after the project. |
| `--environment <name>` | The Coolify or Dokploy environment. Default: `production`, created when it does not exist. |
| `--github-app <app>` | The Coolify GitHub App that reads a private repository, or `public`. Asked for when Coolify has GitHub Apps. |
| `--path <path>` | The project directory on a server over SSH. Default: `/srv/<project>`. |
| `--deploy`, `--no-deploy` | Deploy when done, or don't ask. |
| `--force` | Set up again, replacing `.dstack/deploy.json`. |
| `-y`, `--yes` | Don't ask; use the flags and the defaults. |

It reads the variables and the domain from `.env.production`, so run
[`production`](#production) first. For Coolify and Dokploy, it adds the
variables that put Caddy behind the platform's proxy (see
[Coolify and Dokploy](./production/platforms.md)), creates a Docker Compose
application from the repository with `compose.yaml`, and gives the `proxy`
service the domain. For a server over SSH, it checks Docker and
the Compose plugin, creates the project directory and uploads the
variables as `shared/.env`.

It then writes `.dstack/deploy.json`: the platform's address and the ids of
the project, environment and application, or the server, its directory
and the Compose project name. The file holds no secrets; commit
it, so everyone who works on the project deploys to the same place. After
setup, the platform keeps the variables: change them there, or change
`.env.production` and run `dstack deploy env push`.

### API keys

The CLI saves an API key in the system keychain (Keychain on macOS,
Credential Manager on Windows, the Secret Service on Linux), per platform
address, and never in the project. Where there is no keychain, such as on a
server without a desktop, it saves the key in
`~/.config/dstack/credentials.json`, readable only by you, and says so.

In CI, set `DSTACK_COOLIFY_TOKEN` or `DSTACK_DOKPLOY_TOKEN`: it overrides a
saved key and nothing is written. Create a Coolify key under
**Keys & Tokens** with the `read`, `write` and `deploy` permissions; the
API must be on under **Settings** › **Advanced**. Create a Dokploy key
under **Settings** › **Profile** › **API/CLI**. Servers over SSH use your
SSH keys and need no API key.

## `doctor`

Checks a project and its running services.

```bash
npx @django-stack/cli doctor [directory]
```

It checks that Docker and Docker Compose v2 are available, that Node.js and
Python are recent enough (a warning only, as in [`init`](#init)), that `.env` has
every required value and two different API keys, and, when the project is
running, that the backend is healthy, the site at `SITE_URL` answers, the
read-only key reads the API and the API is closed without a key. With the
`prod` profile it also checks that `SITE_URL` is `https` and that mail goes to
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
press Tab. It needs `dstack` on your `PATH`; see
[Install `dstack`](#install-dstack).

```bash
dstack completion zsh|bash|fish|powershell
```

Add it to your shell's startup file:

| Shell | Line |
|-------|------|
| zsh, in `~/.zshrc` | `source <(dstack completion zsh)` |
| bash, in `~/.bashrc` | `source <(dstack completion bash)` |
| fish, in `~/.config/fish/config.fish` | `dstack completion fish \| source` |
| PowerShell, in `$PROFILE` | `dstack completion powershell \| Out-String \| Invoke-Expression` |

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
