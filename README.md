# DjangoStack

DjangoStack creates a ready-to-run website project in one command: a Django
backend with [Django Headless](https://djangoheadless.org) for the content
API and [Django Content Studio](https://djangocontentstudio.org) as the
admin, an Astro or Next.js frontend, Postgres, and Docker Compose for
development and production.

```bash
npx @django-stack/cli init my-site
```

DjangoStack is in early development. Version 0.1 creates projects with the
Astro frontend for development with Docker Compose; production deployment
and the Next.js frontend follow. Read the
[getting started guide](website/docs/getting-started.md).

## This repository

| Path | Contents |
|------|----------|
| `packages/cli` | `@django-stack/cli`: `init`, `doctor` and later `add` and `upgrade` |
| `packages/utils` | `@django-stack/utils`: the API client, content helpers, SEO, images and webhook signatures |
| `packages/react` | `@django-stack/react`: React components |
| `packages/next` | `@django-stack/next`: Next.js glue |
| `python/django-stack` | `django-stack` on PyPI: settings, API defaults, health checks, system checks |
| `templates/` | The files `init` copies into a new project |
| `scripts/e2e.sh` | The end-to-end test: creates a project with the CLI and runs it with Docker Compose |
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

See [CONTRIBUTING.md](CONTRIBUTING.md) for changesets and releases, and
[AGENTS.md](AGENTS.md) for the layout and conventions.

## License

MIT; see [LICENSE](LICENSE).
