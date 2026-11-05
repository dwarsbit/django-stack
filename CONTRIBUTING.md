# Contributing

1. Fork the repository and create a branch.
2. Make the change and add tests for it.
3. Run the checks: `pnpm lint`, `pnpm build`, `pnpm typecheck`, `pnpm test`,
   and in `python/django-stack` `uv run ruff check .` and `uv run pytest`.
4. For a change users notice, add an entry under the unreleased version in
   `CHANGELOG.md`.
5. Open a pull request.

## Releases

The npm packages and `django-stack` on PyPI share one version. The
next one is the `## X.Y.Z (unreleased)` heading in `CHANGELOG.md`.

To release it, run the **Release** workflow from `main` (Actions, Release,
Run workflow). It checks that CI on `main` is green and the tag is new,
sets the version everywhere with `scripts/bump_version.py`, dates the
changelog heading, commits, pushes the tag `vX.Y.Z`, publishes to npm (with
provenance) and PyPI through trusted publishing, and creates a GitHub
Release with the changelog section as notes. A version like `1.2.0-rc.1`
is published under the npm tag `next` and as a GitHub prerelease.

After a release, add the next `## X.Y.Z (unreleased)` heading with your
first change.

## Where a change belongs

DjangoStack is glue. A feature of the content API belongs in
[Django Headless](https://github.com/dwarsbit/django-headless), and a
feature of the admin in
[Django Content Studio](https://github.com/dwarsbit/django-content-studio).

## Frontends

`init --frontend <name>` copies `templates/frontend-<name>` to the
project's `frontend/` directory. Every frontend template builds the same
site on the same contract, so `compose.yaml`, the Caddyfile, the backend
and the docs work with any of them:

| Area | What the template does |
|------|------------------------|
| Pages | The home page, the blog with posts, categories and tags, pages by path from Django Headless, redirects and a 404 page, with blocks, rich text, images and SEO tags. |
| Forms | The contact form, posted to `/api/content.formsubmission`. |
| Preview | `/preview` checks the signed token and stores it in the HTTP-only `stack_preview` cookie; `/preview/exit` removes it. |
| Revalidation | `POST /revalidate` verifies the signed webhook and empties the page cache (`CACHE_TTL`). |
| Feeds | `/robots.txt`, `/sitemap.xml` and `/rss.xml`. |
| Security | `API_READ_KEY` is used on the server only and never reaches the browser. Every page has a Content-Security-Policy that allows the media origins in `MEDIA_ORIGINS`. |
| Development | The dev server listens on port 3000, allows the host `frontend` and proxies `/admin`, `/api`, `/media` and `/static` to `BACKEND_INTERNAL_URL`. |
| Production | The Dockerfile has `dev` and `prod` targets. `prod` runs a Node server on port 3000 as the `node` user in a read-only container, with a healthcheck on `/robots.txt`. |
| Scripts | `dev`, `build`, `start`, `check` (type checks, run by `dstack check`), `test` and `generate:types`. The API types are in `src/lib/headless.ts`, where `dstack types` writes them. |
| Files | `template.json` with the framework's `label`, `url` and `security` page, for the project's README, AGENTS.md and SECURITY.md (`init` removes it), and `AGENTS.md` with the frontend's layout, how to read a content model and how to render a block type. |

Shared logic goes in `@django-stack/utils`, which has no framework
dependency; components for one framework go in its package, such as
`@django-stack/svelte`. `test/scaffold.test.ts` checks the files and
scripts above. `scripts/e2e.sh` and `scripts/e2e-prod.sh` test a frontend
with `FRONTEND=<name>`, and CI runs them for every frontend in the `e2e`
job's `frontend` list. A new frontend is a value appended to the frontend
option in `packages/cli/src/stack.ts`, marked `generated: true` once its
template passes these tests.

## Deploy providers

`dstack deploy` talks to hosting platforms through providers in
`packages/cli/src/deploy/`. The commands only use the `DeployProvider`
interface in `provider.ts`, so a new platform is a new provider and an
entry in `PROVIDERS` in `index.ts`, without changes to the commands. A
provider declares:

| Field | What it says |
|-------|--------------|
| `auth` | How the CLI gets in: `{ kind: "token" }` with the environment variable that overrides the saved API key and where to create one, or `{ kind: "ssh" }` for the user's own SSH keys and `~/.ssh/config`. `deploy login` and `deploy logout` work only for token providers. |
| `source` | What a deploy builds: `"remote"`, the branch on the git remote, or `"local"`, the local commit, which the provider uploads. Before a deploy the CLI checks that the commit is pushed (`remote`) or that there are no uncommitted changes (`local`); `--no-push-check` skips the check. `deploy setup` reads the repository only for `remote`. |
| `target` | What `--url` names: the prompt, a placeholder and a function that normalizes the value. `urlTarget()` builds it for a platform with a web address. |
| `platformEnv` | Variables the platform needs on top of `.env.production`. |
| `setupFlags` | The provider's own flags of `deploy setup`. |
| `connect()` | Returns a `ProviderClient`, which sets up the application and starts, lists and reads deploys. |

`.dstack/deploy.json` holds the target and three provider-defined ids. It
never holds secrets. Test a provider's client against a fake `fetch` or a
fake command runner, as `test/deploy.test.ts` does for Coolify.

## First publish (claiming the names)

npm trusted publishing can only be configured for a package that exists, so
the first `0.0.1` of each npm package is published by hand:

1. Create the `django-stack` organization on npmjs.com.
2. Build and publish from a clean checkout of `main`:

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   # Provenance only works in CI, and publishConfig would force it.
   pnpm -r --filter "./packages/*" exec npm pkg delete publishConfig.provenance
   pnpm -r --filter "./packages/*" publish --access public --no-git-checks
   git checkout -- packages/*/package.json
   ```

3. On npmjs.com, add `dwarsbit/django-stack` with the workflow
   `release.yml` as a trusted publisher of each package.
4. On pypi.org, add a pending trusted publisher for the project
   `django-stack`: repository `dwarsbit/django-stack`, workflow
   `release.yml`, environment `pypi`.
