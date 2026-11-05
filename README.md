# DjangoStack

**Developer-first Django tooling.** The production-ready Django, batteries included stack.

DjangoStack creates a ready-to-run website project in one command: a Django
backend with [Django Headless](https://djangoheadless.org) for the content
API and [Django Content Studio](https://djangocontentstudio.org) as the
admin, an Astro or Next.js frontend, Postgres, and Docker Compose for
development and production.

```bash
npx @django-stack/cli init my-site
```

DjangoStack is in early development. It creates projects with the Astro
frontend that run in development and in production on your own server,
behind Caddy with HTTPS and daily backups; the Next.js frontend follows.
The documentation is at https://dwarsbit.github.io/django-stack/: start
with [Getting started](https://dwarsbit.github.io/django-stack/docs/getting-started)
and [Deploy to a server](https://dwarsbit.github.io/django-stack/docs/production/server).

## This repository

| Path | Contents |
|------|----------|
| `packages/cli` | `@django-stack/cli`: `init`, `production`, `doctor` and later `add` and `upgrade` |
| `packages/utils` | `@django-stack/utils`: the API client, content helpers, SEO, images and webhook signatures |
| `packages/react` | `@django-stack/react`: React components |
| `packages/next` | `@django-stack/next`: Next.js glue |
| `python/django-stack` | `django-stack` on PyPI: settings, API defaults, health checks, system checks, backups |
| `templates/` | The files `init` copies into a new project |
| `scripts/e2e.sh`, `scripts/e2e-prod.sh` | The end-to-end tests: create a project with the CLI and run it with Docker Compose, in development and in production |
| `website/` | The documentation site (Docusaurus) |

## Development

You need Node.js 22, pnpm 10 and uv.

```bash
pnpm install
pnpm build      # build the npm packages
pnpm test       # run their tests
pnpm lint       # Biome

cd python/django-stack
uv sync
uv run pytest
uv run ruff check .
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the changelog and releases, and
[AGENTS.md](AGENTS.md) for the layout and conventions.

## License

MIT; see [LICENSE](LICENSE).
