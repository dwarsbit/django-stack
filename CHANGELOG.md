# Changelog

All packages share one version: `@django-stack/cli`, `@django-stack/utils`,
`@django-stack/react`, `@django-stack/next`, `@django-stack/svelte`,
`@django-stack/vue` on npm and `django-stack` on PyPI. Add your change under
the unreleased version; the release workflow releases it.

## 0.12.1 (unreleased)

- **A clear error for the database of an earlier project.** Docker keeps
  the volumes of a deleted project, and a new project with the same name
  started on that old database, whose password is not the one in the new
  `.env`: "password authentication failed for user app". `init` now finds
  the data of an earlier project with the same name and offers to remove
  it, and the backend stops at once with what to do instead of retrying.

## 0.12.0 (2026-11-08)

- **A dashboard in the admin.** New projects open the admin on a
  dashboard with the published pages and posts, the contact form
  submissions of the last 30 days and the latest ones, the activity log,
  the queued and failed tasks, and, with analytics on, the visitors and
  the most visited pages. The widgets are listed in
  `backend/config/studio.py`; those of the content models are in
  `backend/content/dashboard.py`. The demo content now includes two
  contact form submissions. Existing projects keep their admin as it is;
  copy the two files from a new project to add the dashboard.
- **Your own Postgres in `dstack production`.** `init` no longer asks for
  a production database URL; its Database question only picks the Postgres
  version. `dstack production` now asks whether the server uses the
  bundled Postgres or your own, and for your own whether you enter a
  `postgres://` URL or the host, port, database name, user and password
  separately. Separate values are URL-encoded for you, so a password with
  `@`, `:`, `/` or `#` works as it is. `--database-url` on `production`
  sets it without asking. A `PRODUCTION_DATABASE_URL` in `.env`, from
  `init --database-url`, is used as before, without the question.
- Form submissions in the admin of new projects are read and delete only:
  no Create button, and a submission can no longer be edited.
- The documentation moved to https://djangostack.org. The package
  metadata, the READMEs and the README of new projects link there.
- The docs homepage title is now "The production-ready batteries included
  Django stack", with "Developer-first Django tooling" as the tagline.
  The README and the `@django-stack/cli` description follow.
- The Status widget on the System page no longer shows when the worker and
  the backup last ran, so its badges line up. The Daily backup row shows
  "Active" when the worker runs daily backups but none ran yet, and "Off"
  only when backups are turned off; `/statusz` reports that as `active`.

## 0.11.0 (2026-11-08)

- **Postgres 18.** `init --postgres latest` now generates Postgres 18,
  with its volume at `/var/lib/postgresql`, where the image keeps a
  directory per version. The backend image installs the Postgres client
  from the PostgreSQL apt repository at the bundled server's major version
  (`ARG POSTGRES_VERSION` in `backend/Dockerfile`), so backups work with
  either. `config` refuses another Postgres version; the backups docs
  show how to upgrade with a backup and a restore.
- **Headless projects.** `init --frontend headless` (and `--preset api`)
  now generates a project with the content API and the admin only: no
  `frontend/` and no frontend service. Django serves the whole domain, in
  development on `SITE_PORT`, with a start page at `/` that links to the
  admin and the API schema (`django_stack.start`). Page analytics is
  off, `REVALIDATE_URL` is empty until you set your frontend's, and
  `dstack types` writes only `backend/openapi.json`. `dstack check`,
  `doctor`, `dev` and `update` skip the frontend when there is none. The
  templates' text files can now hold `# @if frontend` / `# @end` blocks.
- Fixed: with page analytics off, the backend did not start with Django
  Content Studio 1.12, whose check `content_studio.E037` refuses the
  `Analytics` components of the page and post studios without an
  `AnalyticsExtension`. `content/admin.py` now adds them only when Umami is
  configured. In an existing project with analytics off, make the same
  change.
- **A local Postgres with an external database.** `init --database-url`
  now saves the URL as `PRODUCTION_DATABASE_URL` and keeps the bundled
  Postgres for development, so local work never writes to the server's
  database. `dstack production` makes it `DATABASE_URL` in
  `.env.production` and leaves out `db`; `dstack run` keeps the bundled
  one. `init` also asks for the external server's Postgres version, for the
  local Postgres and the backups' client. Existing projects with
  `DATABASE_URL` set to an external Postgres keep working as before.
- **`django_stack.contrib.site`**, for a site Django renders with
  templates (the coming `--frontend templates`): the `/preview` and
  `/preview/exit` routes with a preview cookie, `published(queryset,
  request)` with the same rules as the content API, the `@site_page`
  decorator (a page cache in Django's cache, emptied when content in the
  `CONTENT_APPS` or the media library changes, and the site's
  Content-Security-Policy), `RedirectMiddleware` for editor-managed
  redirects, a context processor, and the `{% blocks %}`, `{% image %}`,
  `{% seo %}`, `link_href` and `is_current` template tags. `/_a/script.js`
  and `/_a/api/send` pass Umami's tracker and page views through where no
  reverse proxy does, as in development.
  `django_stack.contrib.captcha.forms.CaptchaField` adds the captcha to a
  Django form, with the `@cap.js/widget` 0.1.58 script vendored as a
  static file.

- **Django templates.** `init --frontend templates` now generates a
  project where Django renders the site: a `website` app in
  `backend/website/` with the pages, the blog, categories, tags, the RSS
  feed, the sitemap, `robots.txt` and the contact form of the Astro
  starter, with its stylesheet, and tests of every page. There is no
  frontend service and no Node; the pages read the content with the ORM
  and `django_stack.contrib.site`. Caddy sends every request but `/media`
  and `/_a/` to the backend. The templates in `templates/` can now also
  hold `@if headless`, `@if templates` and `@if site` blocks.

## 0.10.0 (2026-11-07)

- **pnpm and Bun.** `init --package-manager` now generates `pnpm`, the
  default, and `bun` next to `npm`. `init` writes the frontend's lockfile
  (`pnpm-lock.yaml`, `bun.lock` or, now also for npm, `package-lock.json`)
  through `npx`, and the frontend's `Dockerfile` installs with that
  package manager from it; the frontend still runs on Node.js. With pnpm,
  `frontend/pnpm-workspace.yaml` resolves only versions published at least
  a day ago and lists the packages allowed to run install scripts. The
  README and `AGENTS.md` show the commands of the chosen package manager.
  `dstack update` now also upgrades the `@django-stack` packages in the
  frontend's lockfile (`--all`: every package). Existing projects keep
  npm.
- **Captcha on the contact form.** `init` now generates `--captcha on`,
  the default: the new `django_stack.contrib.captcha` app serves the Cap
  protocol at `/api/cap/`, with its tokens in the database, and every
  create in `PUBLIC_CREATE` without an API key or staff login needs a
  `captcha` field with a token. The contact forms of all four frontends
  show Cap's widget, which solves a proof of work in the browser and
  loads its solver from the site; their Content-Security-Policy allows it.
  The new `Captcha` component of `@django-stack/react`, `@django-stack/vue`
  and `@django-stack/svelte`, `loadCaptcha`, `resetCaptcha` and
  `CAPTCHA_CSP` of `@django-stack/utils`, the `captcha` option of
  `contentSecurityPolicy` in `@django-stack/next`, and `CaptchaField` and
  `verify_captcha` in Django protect your own forms. `CAPTCHA=off` in
  `.env` (or `init --captcha off`, `dstack config --captcha off`) turns it
  off; `CAPTCHA_THROTTLE_RATE` limits challenges per IP address (default
  `30/minute`). Existing projects keep working without it; to add it,
  follow the captcha docs.
- **Error reports to Sentry.** `init --errors sentry` (and `ERRORS=sentry`
  in `.env`) sends the errors of the backend and the worker, and every
  line logged at `ERROR`, to the sentry.io project of `SENTRY_DSN`,
  tagged with the request ID and without personal data.
  `SENTRY_ENVIRONMENT` names the environment (`production` by default)
  and `SENTRY_TRACES_SAMPLE_RATE` (0 to 1) also sends performance traces.
  The `server` extra of `django-stack` now includes `sentry-sdk`.
- **Frontend errors to Sentry.** With `ERRORS=sentry`, the server errors
  of the frontend (a page or route that fails with a 5xx) go to the same
  Sentry project, tagged with the request ID. Nothing runs in the
  browser. Each frontend calls the new `reportError()` of
  `@django-stack/utils` from its error hook: the Astro middleware,
  `src/instrumentation.ts` in Next.js, `server/plugins/errors.ts` in Nuxt
  and `handleError` in `src/hooks.server.ts` in SvelteKit. To add it to an
  existing project, copy that hook from the template and add these lines
  to `x-frontend-env` in `compose.yaml`:

  ```yaml
  ERRORS: ${ERRORS:-email}
  SENTRY_DSN: ${SENTRY_DSN:-}
  SENTRY_ENVIRONMENT: ${SENTRY_ENVIRONMENT:-production}
  SENTRY_RELEASE: ${SENTRY_RELEASE:-}
  ```

## 0.9.0 (2026-11-07)

- **System page in the admin.** Superusers get **System** in the user
  menu: a page with the database, cache, worker and backup checks, when
  the worker and the last backup ran, and the latest error reports. It is
  `django_stack.studio.SystemPage` with `SystemLink`, built from Django
  Content Studio's dashboard widgets. To add it to an existing project,
  import both from `django_stack.studio` in `backend/config/studio.py`
  and add `SystemPage()` and `SystemLink()` to `extensions`.
- **Error reports by email.** In production, each new error of the
  backend, the worker or a backup (anything logged at `ERROR`) is now
  mailed to the active superusers with its traceback and request ID, and
  shows as a "Server errors" notification in the admin when Content
  Studio's notifications app is installed. The same error is reported once
  an hour at most. `ERROR_EMAIL` sends the mail to other addresses instead,
  and `ERRORS=off` turns the reports off. `init` has a new option,
  `--errors email|off` (`sentry` comes later); `email` is the default.
  Existing projects get the reports too after the update; add
  `ERRORS=off` to `.env` to keep the logs only.
- **Worker and backup health checks.** The worker now records a heartbeat
  in the cache every minute and the time of each daily backup. The new
  `/statusz` health check, `dstack status` and `dstack manage health`
  report the database, the cache, the worker (failing after three minutes
  without a heartbeat) and the backup (failing when the last one is more
  than 26 hours old). The worker's healthcheck in `compose.yaml` runs
  `python manage.py worker_alive`, so a worker that stopped running tasks
  shows as `unhealthy`. Set `BACKUP_PING_URL` to a Healthchecks.io check or
  an Uptime Kuma push monitor to get an alert when daily backups stop. In
  an existing project, give the `worker` and `worker-prod` services
  `healthcheck: {test: ["CMD", "python", "manage.py", "worker_alive"], interval: 30s, timeout: 20s, start_period: 120s, retries: 3}`
  (in `worker-prod`, in place of `disable: true`).
- **JSON logs and request IDs.** In production (`DJANGO_DEBUG=0`) Django,
  the worker and Caddy now write one JSON object per line; development
  keeps plain text. `LOG_FORMAT=json` or `plain` picks the format, and
  `LOG_LEVEL` the level. Caddy gives every request an ID in the
  `X-Request-ID` header, and the new `django_stack.logs.RequestIdMiddleware`
  adds it to every log line of that request, returns it in the response
  and writes one access log line per request, without the health checks
  (`LOG_ACCESS=0` turns it off). Gunicorn no longer writes its own access
  log. Docker keeps at most five log files of 10 MB per container. In an
  existing project, add `"django_stack.logs.RequestIdMiddleware"` as the
  first entry of `MIDDLEWARE` in `backend/config/settings.py`, remove
  `"--access-logfile", "-",` from the `CMD` in `backend/Dockerfile`, add
  `request_header X-Request-ID {http.request.uuid}` and
  `log_append request_id {http.request.uuid}` to the site block of the
  `Caddyfile` and change its `format console` to `format json`, and add a
  `logging` entry with `driver: json-file` and the options
  `max-size: 10m` and `max-file: "5"` to each service in `compose.yaml`.
- **Notifications.** `init` now turns on Django Content Studio's
  notifications unless you pass `--notifications off` (presets with
  notifications on, such as the default, now get them). Editors get them in
  the admin, and what they leave unread for an hour by email. The backend
  gets `content_studio.notifications` in `INSTALLED_APPS` and a contact form
  event in `backend/content/notifications.py`. `django_stack.tasks` runs
  the email digest hourly and prunes old notifications nightly in the
  worker, and `django_stack.settings` turns `NOTIFICATION_EMAIL_DIGEST` on.
  To add them to an existing project, add the app to `INSTALLED_APPS` (or
  run `dstack config --notifications on`), copy
  `backend/content/notifications.py` and the `ready()` of
  `backend/content/apps.py` from a new project, and run `migrate`.
- **`dstack config --notifications`** adds or removes the app in
  `backend/config/settings.py`.
- **Railway deploys.** `dstack deploy setup --provider railway` creates a
  Railway project with one service per production service of
  `compose.yaml`: Railway builds the backend, the worker and the frontend
  from their directories in the GitHub repository and deploys them on
  every push, Postgres runs Railway's own Postgres image with a volume, and
  the `proxy` service gets the domain, with the `Caddyfile` in a variable.
  Uploads must be in S3. `dstack deploy`, `status`, `logs`, `rollback` and
  `env push` work on all the built services together. Create a token at
  railway.com/account/tokens, or set `DSTACK_RAILWAY_TOKEN`. New
  `deploy setup` flag: `--workspace`.
- **No BuildKit cache mounts in the Dockerfiles.** Railway rejects
  `RUN --mount=type=cache`, so new projects install their Python and npm
  packages without them; Docker still caches the layer until the lock file
  changes. To deploy an existing project to Railway, remove
  `--mount=type=cache,target=/root/.cache/uv` from `backend/Dockerfile`
  and `--mount=type=cache,target=/root/.npm` from `frontend/Dockerfile`.

## 0.8.1 (2026-11-06)

### Fixes

- Fixed: the Astro frontend of `dstack dev` did not start again after the
  project stopped, with "Another astro dev server is already running".
  Astro's lock file `frontend/.astro/dev.json` stays behind in the mounted
  folder, and the new container reuses the old process IDs. The dev
  container now removes the lock file before it starts Astro. In an
  existing project, delete `frontend/.astro/dev.json`, or change the `CMD`
  of the `dev` target in `frontend/Dockerfile` to
  `CMD ["sh", "-c", "rm -f .astro/dev.json && exec npm run dev"]`.

## 0.8.0 (2026-11-06)

- **`dstack self-update`.** Updates `dstack` to the latest version on npm
  with the package manager that installed it: npm, pnpm, Bun or Yarn. It
  changes nothing when you have the latest version, and warns when another
  install of `dstack` comes first on your `PATH`. The update notice now
  says `dstack self-update` for an installed `dstack`.

### Fixes

- Fixed: a project created with the CLI from npm did not start, with
  `exec /app/entrypoint.sh: permission denied`, because the npm package
  lost the executable bit of `backend/entrypoint.sh`. `init` now makes
  `entrypoint.sh` and `manage.py` executable, and the backend `Dockerfile`
  runs the entrypoint with `sh`. Every `dstack` project command also
  repairs the file mode, so `dstack dev` starts an existing project again.
  Without `dstack`, run `chmod +x backend/entrypoint.sh backend/manage.py`
  or change both `ENTRYPOINT` lines in `backend/Dockerfile` to
  `ENTRYPOINT ["sh", "/app/entrypoint.sh"]`.

## 0.7.0 (2026-11-06)

- **The cache and the task queue in Postgres.** New projects keep the
  cache in a database table (`CACHE_URL=db://`) and Huey's task queue in
  `huey_*` tables (`TASKS_URL=db://`), so the default stack runs no Valkey.
  `migrate` creates the tables. `init --cache valkey` runs Valkey for both,
  as before; `--tasks huey-valkey` puts only the queue in Valkey; `--cache
  off` keeps a cache per process; `--tasks off` runs tasks in the request
  without a worker (`TASKS_URL=immediate://`, `TASK_WORKERS=0`), with no
  daily backups. `init` asks for the cache before the tasks, and the tasks
  follow it. The `cache` service is now in the `valkey` profile.
- **`dstack config --cache` and `--tasks`** switch an existing project,
  turning the `valkey` profile on or off.
- **`TASKS_URL`** in `django_stack.settings`: `db://`, `redis://` or
  `immediate://`. Projects without it keep their queue in a Redis
  `CACHE_URL`. `CACHE_URL` accepts `db://`. New deploy check
  `django_stack.W006` warns when tasks run in the request.
- **Existing projects** keep working unchanged. To drop Valkey, set
  `CACHE_URL=db://` and `TASKS_URL=db://` in `.env`, add `profiles: [valkey]`
  to the `cache` service and `required: false` to its `depends_on` entry in
  `compose.yaml`, and run `migrate`.
- **Six-character preset codes.** `init` and `dstack preset` now print
  presets as six letters and digits, such as `b7mWME`, instead of one
  character per option, so the default stack no longer has the code `a`.
  A mistyped code is refused rather than read as another stack. The
  shorter codes that start with `a` keep working, also in the
  `package.json` of existing projects.
- **`dstack dev` in the next steps.** `init` now offers to install `dstack`
  before it prints the next steps, and the next steps say `dstack dev`
  when `dstack` is installed, `docker compose up` otherwise.
- **Free ports in development.** When port 3000, 8000, 8025 or 8333 is
  in use, such as by another project, `init` and `dstack dev` take the next
  free one and save it in `.env` as `SITE_PORT`, `BACKEND_PORT`,
  `MAIL_PORT` or `S3_PORT`, with `SITE_URL`, `BACKEND_URL` and the local
  `S3_PUBLIC_URL` to match. `compose.yaml` publishes the ports from these
  variables. In an existing project, `dstack dev` only says which port is
  in use; to have it move ports, change the `ports` of `frontend`,
  `backend`, `mailpit` and `s3` in `compose.yaml` to
  `"127.0.0.1:${SITE_PORT:-3000}:3000"`,
  `"127.0.0.1:${BACKEND_PORT:-8000}:8000"`,
  `"127.0.0.1:${MAIL_PORT:-8025}:8025"` and
  `"127.0.0.1:${S3_PORT:-8333}:8333"`.
- **Uploads in production.** `init` now asks whether uploads go to S3 in
  production (`--media s3`) or stay on the server (`--media server`, the
  default), before it asks about uploads in development, which then
  suggests the local S3 service. It asks for no credentials: with S3,
  `dstack production` and `dstack settings` ask for the `S3_*` variables.
  `dstack config --media` changes it later.
- **`dstack settings`.** Asks for the production settings and credentials
  that are missing in `.env.production`, one at a time: `ADMIN_EMAIL`,
  the SMTP server, port, user name and password for `EMAIL_URL`, and the
  `S3_*` variables when uploads go to S3. `--set NAME=value` sets them
  without asking, `--all` asks for every setting again, and `--yes` lists
  what is missing and exits 1. `dstack production` offers to ask for them
  right after it writes `.env.production`.

### Fixes

- Fixed: the project commands, such as `dstack dev`, and `dstack deploy`
  to Bunny printed Docker's `failed to connect to the docker API` error
  when Docker was not running; they now stop with `Docker not running.`
  and how to start it.

## 0.6.0 (2026-11-06)

- **Page analytics with Umami.** `init` now runs Umami for page analytics
  unless you pass `--analytics off` (presets with analytics on, such as the
  default `a`, now get it). The `umami` service in the new `analytics`
  profile keeps its tables in the `umami` schema of the project's database,
  so backups include them. Only its tracker and the page views pass through
  the site, at `/_a/script.js` and `/_a/api/send`; its interface and API
  stay on the internal network. Every frontend loads the tracker when
  `UMAMI_WEBSITE_ID` is set. The admin shows the numbers under
  **Analytics**, through Django Content Studio's analytics page. `init`
  writes `UMAMI_URL`, `UMAMI_WEBSITE_ID`, `UMAMI_ADMIN_PASSWORD`,
  `UMAMI_APP_SECRET` and `UMAMI_DATABASE_URL` to `.env`, and `production`
  gives the server new secrets.
- **Analytics of each page and post.** The page and post edit forms in the
  admin show the visitors, page views and top sources of that page, with
  Django Content Studio's `Analytics` component in
  `backend/content/admin.py`. It is hidden while analytics are off. To add
  it to an existing project, copy `PAGE_ANALYTICS` and `POST_ANALYTICS`
  and their places in `edit_sidebar` from a new project.
- **`dstack config --analytics`.** Turns analytics on or off in a project
  that has the `umami` service, keeping Umami's website and data.
- **`django_stack.analytics.UmamiProvider`** connects Django Content
  Studio's analytics to the bundled Umami with its admin password, and
  `manage.py setup_umami` replaces Umami's default admin password and
  creates the site's website; the backend runs it on every start when
  `UMAMI_URL` is set. `django-stack` now needs Django Content Studio 1.11.
  Existing projects keep working without analytics. To add them, copy the
  `umami` service and its `x-backend-depends` and `x-frontend-env` entries
  from a new project's `compose.yaml`, the `/_a/` block of its
  `Caddyfile`, the `setup_umami` lines of `backend/entrypoint.sh`, the
  analytics lines of `backend/config/studio.py` and the frontend's tracker
  and `/_a/` proxy, then run `dstack config --analytics umami`.
- **Deploy to Bunny Magic Containers.** `dstack deploy setup --provider
  bunny` turns the production services of `compose.yaml` into one Magic
  Containers app: it builds the images of the last commit for
  `linux/amd64`, pushes them to Bunny Container Registry with the account
  API key, creates a container per service in one pod (hosts such as
  `db:5432` become `127.0.0.1`, the `Caddyfile` is copied into the proxy
  image, Postgres gets the one volume) and adds the domain to the app's CDN
  pull zone. `dstack deploy` pushes new images tagged with the commit and
  changes the containers' tags; `dstack deploy rollback` goes back to an
  earlier tag. Uploads must be in S3. Written from Bunny's API
  documentation and not yet tested on a real account.
- Providers can have a fixed target (no `--url`), print their own DNS
  record, and get the project directory in `deploy setup` and in the link.

## 0.5.0 (2026-11-05)

- Publishes `@django-stack/utils`, `@django-stack/svelte` and
  `@django-stack/vue` through npm trusted publishing, which the 0.4.0
  release did not.

## 0.4.0 (2026-11-05)

- **SvelteKit frontend.** `npx @django-stack/cli init --frontend
  sveltekit` (preset `a5`) creates the site with SvelteKit and the Node
  adapter instead of Astro: the same pages, preview, revalidation, feeds and
  Content-Security-Policy. Content loads in server load functions only, so
  the API key stays on the server. The new `@django-stack/svelte` package
  has the components for blocks, rich text, images and SEO tags.
- **Nuxt frontend.** `npx @django-stack/cli init --frontend nuxt` (preset
  `a4`) creates the site with Nuxt and Nitro's Node server instead of
  Astro: the same pages, preview, revalidation, feeds and
  Content-Security-Policy (through `nuxt-security`). Pages load content
  from the frontend's own server routes under `/_content/`, so the API key
  stays on the server. The new `@django-stack/vue` package has the
  components for blocks, rich text and images.
- **Next.js frontend.** `npx @django-stack/cli init --frontend next`
  creates the site with Next.js 16 and the App Router instead of Astro: the
  same pages, preview, revalidation, feeds and Content-Security-Policy, with
  a nonce from `src/proxy.ts`. API responses stay in Next's data cache until
  Django calls `/revalidate`. `@django-stack/react` now has the components
  for blocks, rich text and images, and `@django-stack/next` the route
  handlers, the metadata and the security headers.

## 0.3.0 (2026-11-05)

- **Deploy to Dokploy.** `dstack deploy setup --provider dokploy --url
  https://dokploy.example.com` creates the project, the environment and a
  compose service from the git repository in Dokploy, gives the `proxy`
  service the domain with a Let's Encrypt certificate and uploads
  `.env.production`, with an API key (`DSTACK_DOKPLOY_TOKEN` in CI).
  `deploy`, `status` and `env push` work as for Coolify; the build log stays
  in Dokploy's dashboard, and `deploy logs` links to it.
- **Deploy to a server over SSH.** `dstack deploy setup --provider ssh
  --url deploy@example.com` checks Docker on the server, creates
  `/srv/<project>` (or `--path`) and uploads `.env.production`.
  `dstack deploy` uploads the last commit as a new release and runs
  `docker compose up` there, detached; `status`, `logs` and `env push` work
  as for Coolify. The CLI uses your `ssh`, keys and `~/.ssh/config`, and
  stores no keys. The server keeps the last five releases.
- **`dstack deploy rollback`** starts the release before the running one
  again, or the deploy you name (servers over SSH).
- New projects keep `.env.production` out of git.
- The CLI and the docs show the shorter install command
  `npm i -g @django-stack/cli`.

## 0.2.0 (2026-11-05)

- **Media backups.** When uploads are on the server's disk, the daily
  backup also archives the `media` volume (`<name>.media.tar.gz`, next to
  the database dump, in the volume and in `BACKUP_S3_BUCKET`, with the same
  retention). `restore_database --media` and `dstack restore --media`
  restore it with the database, `restore_media` on its own, and
  `dstack backup --no-media` or `BACKUP_MEDIA=0` skip it. Media in S3 is
  not archived; storing uploads in S3 is still the recommended setup.
- **Backups in the worker.** The daily backup is a Huey periodic task in
  `worker-prod` (`django_stack.tasks.daily_backup`, on with
  `BACKUP_DAILY=1`), and new projects no longer have a `backup` service. It
  checks every hour and when the worker starts, so a backup missed while
  the server was down is made when it is back, and a failed backup is
  retried three times, ten minutes apart. `run_backups` and the `backup`
  service of existing projects keep working.
- **Deploy to Coolify.** `dstack deploy setup` creates the project and the
  application in Coolify from the git repository (Docker Compose build
  pack, built on the server), sets the domain and uploads
  `.env.production`. `dstack deploy` starts a deploy and follows it,
  `dstack deploy status` shows the site's state and the last deploys, and
  `dstack deploy logs` prints a build log. `dstack deploy env push` uploads
  the variables again. The Coolify API key is saved in the system keychain
  (`dstack deploy login`), or read from `DSTACK_COOLIFY_TOKEN` in CI.
  Platforms are providers behind one interface, so others can follow.
- **Tool checks.** `init` first checks that Docker is installed and running
  with Docker Compose v2, and that Node.js 22 or later and Python 3.12 or
  later are installed. A missing or old tool is a warning with the install
  command for your operating system; the project is created anyway, and
  `--start` does not start it when Docker is not ready. `doctor` and
  `check` show the same checks; Node.js and Python only warn.

## 0.1.0 (2026-11-05)

- **First release.** `init` creates a Docker Compose project with a Django
  backend (Django Headless and Django Content Studio), an Astro frontend,
  Postgres, Valkey and Mailpit, with a starter content model, demo
  content, preview and revalidation. `doctor` checks a project.
  `@django-stack/utils` has the typed content client, the preview and
  webhook signatures, and the image and SEO helpers.
- **Production.** The `production` command writes `.env.production` for a
  server, and `doctor` checks the prod profile. New projects run in
  production behind Caddy with HTTPS, hardened containers, daily database
  backups and an optional GitHub Actions deploy workflow.
- **Stack options.** `init` asks for every stack option, each with a flag:
  `--frontend`, `--postgres`, `--analytics`, `--tasks`, `--cache`,
  `--notifications`, `--captcha`, `--storage` and `--package-manager`.
  `--preset <code>` sets them all at once, `init` prints the preset of the
  project it created, and `preset` makes or reads a code. There are named
  presets: `blog`, `api` and `minimal`. Values this release does not
  generate yet are listed but refused. `--storage s3` adds a local S3
  service; the old `--local-s3` flag still works.
- **CLI.** Commands are built with Commander, so every command has
  `--help`, typos get a suggestion and invalid values fail with one line.
  The output has colors, `init` asks for the backend's time zone
  (`--time-zone`) with a list you filter by typing and picks the extras in
  one list, and `completion <shell>` prints a Tab completion script. Each
  command checks npm once a day for a newer version and shows a notice;
  turn it off with `--no-update-check` or `DJANGO_STACK_NO_UPDATE_CHECK=1`.
- **`dstack` command.** The CLI's command is now `dstack` (it was
  `django-stack`). When you run it with `npx`, `pnpm dlx` or `bunx`, it
  offers once to install `dstack` globally with the same package manager,
  remembers the answer, and explains a permission error instead of
  failing. Turn the offer off with `--no-install-prompt` or
  `DJANGO_STACK_NO_INSTALL_PROMPT=1`.
- **Project commands.** `dstack dev` runs the development servers with hot
  reload, and `dstack run` the production setup in the background; on a
  development machine `run` writes `.env.run` and starts the prod profile
  at https://site.localhost as its own Compose project, with its own data.
  `dstack stop`, `logs`, `manage`, `shell`, `backup`, `restore` and `types`
  wrap the matching Compose and Django commands. `dstack check` runs the
  doctor's checks, Django's checks, the migrations check and the linters
  (`--tests` adds the tests). `dstack update` upgrades `django-stack` in
  `uv.lock`, pulls and rebuilds the images and restarts what was running.
  `dstack config` changes the stack options of a project (this release:
  `--storage`). Each command finds the project from any directory in it,
  or takes `-C <directory>`. `init` saves the stack's preset in
  `package.json`, and `compose.yaml` reads the containers' variables from
  `${ENV_FILE:-.env}`.
- **Tagline.** The `@django-stack/cli` description and README lead with
  "The production-ready Django, batteries included stack."

## 0.0.1 (2026-11-04)

- Placeholder release that claimed the package names on npm and PyPI.
