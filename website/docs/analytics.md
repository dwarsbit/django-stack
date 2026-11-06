---
sidebar_position: 6
---

# 📊 Page analytics

A project counts its page views with [Umami](https://umami.is), an
open-source analytics tool that sets no cookies. Editors see the visitors,
page views, top pages, sources and devices in the admin under
**Analytics**. Umami runs next to the site on the internal network: only its
tracker and the page views pass through the site, never its interface or its
API.

`init` turns analytics on unless you pass `--analytics off`.

## What `init` sets up

- **The `umami` service** in `compose.yaml`, in the `analytics` profile,
  which `init` adds to `COMPOSE_PROFILES`. It runs in development and in
  production, read-only like the other production services.
- **Its tables in the project's database**, in the `umami` schema
  (`UMAMI_DATABASE_URL` is `DATABASE_URL` with `?schema=umami`). Backups and
  restores include them, and an external Postgres works the same way.
- **The tracker on every page.** The frontend adds Umami's script when
  `UMAMI_WEBSITE_ID` is set:

  ```html
  <script defer src="/_a/script.js" data-website-id="…"></script>
  ```

  It loads from the site itself, so the Content-Security-Policy needs no
  other origin.
- **The route.** Caddy in production, and the frontend's dev server in
  development, pass `/_a/script.js` and `/_a/api/send` to Umami. Every other
  path under `/_a/` answers 404.
- **The setup.** On every start the backend runs
  `python manage.py setup_umami`. It replaces Umami's default admin password
  with `UMAMI_ADMIN_PASSWORD` and creates the website `UMAMI_WEBSITE_ID` for
  the host of `SITE_URL`, or updates the host when `SITE_URL` changed. When
  Umami does not answer, the site starts without analytics and the backend's
  log says why.
- **The admin page.** `backend/config/studio.py` adds Django Content
  Studio's analytics page with `django_stack.analytics.UmamiProvider`, which
  logs in to Umami with the admin password:

  ```python
  # backend/config/studio.py (part)
  if UmamiProvider.is_configured():
      extensions += [AnalyticsExtension(provider=UmamiProvider()), AnalyticsPage(), AnalyticsLink()]
  ```

  Django Content Studio also has dashboard widgets and an analytics panel
  for a page's edit form that read from the same provider; see its
  [documentation](https://djangocontentstudio.org/docs/extensions).

## Variables

`init` writes them to `.env`, and `production` gives the server new
secrets.

| Variable | Description |
|----------|-------------|
| `UMAMI_URL` | Umami's address on the internal network, `http://umami:3000`. Empty turns analytics off. |
| `UMAMI_WEBSITE_ID` | The ID of the site in Umami, a UUID. The frontend puts it in the tracker. |
| `UMAMI_ADMIN_PASSWORD` | The password of Umami's `admin` user. The backend reads the numbers with it. |
| `UMAMI_APP_SECRET` | Signs Umami's login tokens. |
| `UMAMI_DATABASE_URL` | Umami's database: `DATABASE_URL` with `?schema=umami`. |

## Turn analytics off or on

`dstack config` switches it in an existing project and keeps the website and
the secrets, so the numbers stay:

```bash
dstack config --analytics off
dstack config --analytics umami
```

Restart the project afterwards. Without `dstack`, remove `analytics` from
`COMPOSE_PROFILES` in `.env` and empty `UMAMI_URL`. Umami's tables stay in
the database either way.

A project created with `--analytics off` has the `umami` service, the route
and the admin code already; `dstack config --analytics umami` fills in the
variables. A project created by an older CLI has none of them: create a
project with the same frontend and copy the `umami` service, its entries in
`x-backend-depends` and `x-frontend-env`, the `/_a/` block of the
`Caddyfile`, the `setup_umami` lines of `backend/entrypoint.sh`, the
analytics lines of `backend/config/studio.py`, and the tracker and the
`/_a/` proxy of the frontend. Then run `dstack config --analytics umami`.

## Caveats

- **Content blockers.** Some browser extensions block analytics scripts
  whatever their path, so the numbers are a lower bound.
- **Restored backups.** A backup holds Umami's admin password from when it
  was made. When `UMAMI_ADMIN_PASSWORD` differs, `setup_umami` fails and
  the admin shows no analytics; set `UMAMI_ADMIN_PASSWORD` to the password
  of the environment the backup came from.
