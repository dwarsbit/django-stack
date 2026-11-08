---
sidebar_position: 2
---

# 🚀 Getting started

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2,
and Node.js 22 or later for the command that creates the project. To work on
the frontend and the backend outside the containers, for example to run the
tests in your editor, you also need Python 3.12 or later.

`init` checks these tools before it asks anything. A missing or old tool is a
warning with the command that installs it on your operating system, such as
`brew install --cask docker` on macOS or `winget install astral-sh.uv` on
Windows. The project is created anyway.

## Create a project

```bash
npx @django-stack/cli init my-site
```

The command asks for the frontend, the database and whether to add demo
content, and creates `my-site` with:

- a Django backend in `backend/`, with a starter content model of pages,
  posts, menus and site settings;
- the frontend in `frontend/`: Astro by default, or Next.js, SvelteKit or
  Nuxt with `--frontend next`, `sveltekit` or `nuxt`. With `--frontend
  templates` Django renders the site from `backend/website/` instead, and
  `--frontend headless` has no site at all;
- `compose.yaml`, which runs both with Postgres and Mailpit;
- `.env` with fresh secrets for this project, and `.env.example` with the
  same names and no values;
- `AGENTS.md` and `CLAUDE.md` for AI coding agents: the layout, the
  commands, the rules, and links to the agent skills of Django Headless
  and Django Content Studio.

Every prompt has a flag, so the command also runs in scripts:

```bash
npx @django-stack/cli init my-site --yes --no-demo-content
```

Before it prints the next steps, the command offers to install `dstack`
globally. The next steps then start the project with `dstack dev`, or with
`docker compose up` when `dstack` is not installed. The commands below use
`dstack`; without it, run them as `npx @django-stack/cli dev` and so on. See the [CLI reference](./cli.md) for every option.

## Start it

```bash
cd my-site
dstack dev
```

`dev` starts the development servers in the foreground; Ctrl+C stops them.
The first start builds the images, creates the database, the admin user and
the demo content. Then open:

| URL | What |
|-----|------|
| http://localhost:3000 | The site |
| http://localhost:3000/admin/ | The admin, Django Content Studio |
| http://localhost:8025 | Mailpit, which catches the mail the site sends |

When a port is in use, for example by another project, `init` and
`dstack dev` take the next free one, such as 3001, and save it in `.env` as
`SITE_PORT`, `BACKEND_PORT`, `MAIL_PORT` or `S3_PORT`, with `SITE_URL` and
`BACKEND_URL` to match. They print the port they took.

Docker keeps a project's database and uploads in volumes named after the
project, also when you delete its directory. A new project with the same
name would start on the old database, whose password is not the new one in
`.env`, so `init` offers to remove that data. If you kept it, the backend
stops with "password authentication failed for user app": run
`docker compose down --volumes` in the project to start over with an empty
database.

Log in to the admin as `admin` with the password that `init` printed. It is
also in `.env` as `ADMIN_PASSWORD`. Change it after you log in.

The admin opens on a dashboard: the published pages and posts, the contact
form submissions of the last 30 days and the latest ones, the latest edits,
the queued and failed tasks, and the visitors and top pages when analytics
are on. `backend/config/studio.py` lists the widgets and
`backend/content/dashboard.py` has the ones of the content models; change
or remove them there. With `--no-demo-content` the same widgets show an
empty site.

## Edit content

Open a page in the admin, change its title and save. Reload the site: it
shows the change. Draft pages and posts are not on the site; the
**Preview** button in the admin opens a draft on the site with a signed,
short-lived link.

## Change the code

The backend and the frontend directories are mounted into their containers,
so the development servers reload when you save a file. Add a field to a model
in `backend/content/models.py`, then create and run the migration:

```bash
dstack manage makemigrations
dstack manage migrate
```

After a model change, update the frontend's API types:

```bash
dstack types
```

### With an AI agent

Coding agents such as Claude Code, Codex or Cursor read `AGENTS.md`, which
links to the agent skills of [Django Headless](https://djangoheadless.org/docs/agents)
and [Django Content Studio](https://djangocontentstudio.org/docs/ai-agents).
The agent reads a skill before it changes the API or the admin, so it uses
their options instead of writing serializers or admin code by hand. The
links follow the latest release of each package.

To load the skills without the links, install them in the project. Install
the Django Headless skill with the [skills](https://www.npmjs.com/package/skills)
command, which asks which agents to install it for, and save the Django
Content Studio skill in your agent's skills folder, here for Claude Code:

```bash
npx skills add dwarsbit/django-headless
mkdir -p .claude/skills/django-content-studio
curl -o .claude/skills/django-content-studio/SKILL.md \
  https://djangocontentstudio.org/skills/django-content-studio/SKILL.md
```

An installed skill does not update itself: install it again after
`dstack update`.

## Check the project

```bash
dstack check
```

It checks Docker, the values in `.env` and the running services, then runs
Django's system checks, the migrations check and the linters, and tells you
what to fix. `--tests` also runs the tests.
