# DjangoStack: guide for AI agents

DjangoStack is a bootstrapper and glue layer: `npx @django-stack/cli init`
creates a Docker Compose project with a Django backend (Django Headless for
the API, Django Content Studio for the admin), an Astro or Next.js frontend,
Postgres and Valkey. It is not a CMS of its own.

## Layout

- `packages/*`: the npm packages (`@django-stack/cli`, `utils`, `react`,
  `next`), TypeScript, built with tsdown, tested with Vitest. The
  platforms of `dstack deploy` are providers in `packages/cli/src/deploy/`;
  `CONTRIBUTING.md` describes the interface.
- `python/django-stack`: the `django-stack` PyPI package, Hatch build
  backend, managed with uv, tested with pytest, linted with Ruff.
- `templates/`: the files `init` copies into a new project. Placeholders
  are `{{project_name}}` style and rendered by the CLI. Templates must stay
  runnable from the repository.
- `scripts/e2e.sh`: the end-to-end test. It creates a project with the CLI
  from this checkout (`init --link`, which builds the local packages into
  the project's `vendor/` directories), starts it with Docker Compose, runs
  the template tests in the containers and smoke-tests the site.
  `scripts/e2e-prod.sh` does the same with the prod profile behind Caddy
  at https://site.localhost, and tests a backup and a restore.
- `website/`: the Docusaurus docs, published to GitHub Pages at
  https://dwarsbit.github.io/django-stack/. `website/STYLE.md` is the
  writing style guide.
- `CHANGELOG.md`: one version for every npm and PyPI package. The
  `Release` workflow (run by hand from `main`) releases the
  `## X.Y.Z (unreleased)` version: `scripts/bump_version.py` sets it
  everywhere, then it tags `vX.Y.Z` and publishes to npm and PyPI.

## Commands

```bash
pnpm install
pnpm lint        # Biome, for JS and TS
pnpm build       # every npm package
pnpm typecheck
pnpm test
pnpm docs:build

cd python/django-stack
uv sync
uv run pytest
uv run ruff check . && uv run ruff format --check .

scripts/e2e.sh        # after pnpm build; needs Docker and uv
scripts/e2e-prod.sh   # the same in production; needs ports 80 and 443
```

## Rules

- Features of the content API belong in django-headless, features of the
  admin in django-content-studio. DjangoStack only configures and connects
  them.
- Secure by default: generated API routes stay closed, the frontend gets
  the read-only key only, secrets are generated, and every relaxation is an
  explicit setting with a system check.
- Production containers are read-only and run without privileges. A
  service that needs to write gets a volume or `/tmp`, never a writable
  image.
- Every CLI prompt has a flag, and every command exits non-zero with a
  one-line reason on failure.
- Add an entry under the unreleased version in `CHANGELOG.md` for every
  change users notice. If there is no unreleased heading, add one with the
  next version (a minor bump for features, a patch for fixes only).
- Commit messages and docs are in English. Read `website/STYLE.md` before
  writing or editing documentation, the docs website or the README: it is
  the voice and terminology of the sibling projects, adapted to DjangoStack.
