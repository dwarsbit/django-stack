---
sidebar_position: 2
---

# Getting started

You need [Docker](https://docs.docker.com/get-docker/) with Docker Compose v2,
and Node.js 22 or later for the command that creates the project.

## Create a project

```bash
npx @django-stack/cli init my-site
```

The command asks for the frontend, the database and whether to add demo
content, and creates `my-site` with:

- a Django backend in `backend/`, with a starter content model of pages,
  posts, menus and site settings;
- an Astro frontend in `frontend/`;
- `compose.yaml`, which runs both with Postgres, Valkey and Mailpit;
- `.env` with fresh secrets for this project, and `.env.example` with the
  same names and no values.

Every prompt has a flag, so the command also runs in scripts:

```bash
npx @django-stack/cli init my-site --yes --no-demo-content
```

When it is done, the command offers to install `dstack` globally, so that
next time you can run `dstack init` and `dstack doctor`. See the
[CLI reference](./cli.md) for every option.

## Start it

```bash
cd my-site
docker compose up
```

The first start builds the images, creates the database, the admin user and
the demo content. Then open:

| URL | What |
|-----|------|
| http://localhost:3000 | The site |
| http://localhost:3000/admin/ | The admin, Django Content Studio |
| http://localhost:8025 | Mailpit, which catches the mail the site sends |

Sign in to the admin as `admin` with the password that `init` printed. It is
also in `.env` as `ADMIN_PASSWORD`. Change it after you sign in.

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
docker compose exec backend python manage.py makemigrations
docker compose exec backend python manage.py migrate
```

After a model change, update the frontend's API types:

```bash
npm run generate:types
```

## Check the project

```bash
npx @django-stack/cli doctor
```

The doctor checks Docker, the values in `.env` and the running services, and
tells you what to fix.
