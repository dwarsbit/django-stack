# DjangoStack: guide for AI agents

DjangoStack is a bootstrapper and glue layer: `npx @django-stack/cli init`
creates a Docker Compose project with a Django backend (Django Headless for
the API, Django Content Studio for the admin), an Astro or Next.js frontend,
Postgres and Valkey. It is not a CMS of its own.

## Layout

- `packages/*`: the npm packages (`@django-stack/cli`, `utils`, `react`,
  `next`), TypeScript, built with tsdown, tested with Vitest. They share
  one version through Changesets (a fixed group).
- `python/django-stack`: the `django-stack` PyPI package, Hatch build
  backend, managed with uv, tested with pytest, linted with Ruff.
- `templates/`: the files `init` copies into a new project. Placeholders
  are `{{project_name}}` style and rendered by the CLI. Templates must stay
  runnable from the repository.
- `examples/`: projects generated from the templates for the end-to-end
  tests. Regenerate them with the CLI; do not edit them by hand.
- `website/`: the Docusaurus docs.

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
```

## Rules

- Features of the content API belong in django-headless, features of the
  admin in django-content-studio. DjangoStack only configures and connects
  them.
- Secure by default: generated API routes stay closed, the frontend gets
  the read-only key only, secrets are generated, and every relaxation is an
  explicit setting with a system check.
- Every CLI prompt has a flag, and every command exits non-zero with a
  one-line reason on failure.
- Add a changeset (`pnpm changeset`) for every change to an npm package.
- Commit messages and docs are in English. Docs follow the voice of the
  sibling projects: "you", plain and precise, sentence-case headings.
