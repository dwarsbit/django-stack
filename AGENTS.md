# DjangoStack: guide for AI agents

DjangoStack is a bootstrapper and glue layer: `npx @django-stack/cli init`
creates a Docker Compose project with a Django backend (Django Headless for
the API, Django Content Studio for the admin), an Astro or Next.js frontend,
Postgres (and Valkey if chosen), and the `dstack` command manages it from development
to deploy.

- **Repository**: https://github.com/dwarsbit/django-stack
- **Packages**: `@django-stack/cli`, `@django-stack/utils`,
  `@django-stack/react`, `@django-stack/next`, `@django-stack/svelte` and
  `@django-stack/vue` on
  npm, `django-stack` on
  PyPI
- **Docs**: https://dwarsbit.github.io/django-stack/
- **License**: MIT

## Design principles

- **Not a CMS**: DjangoStack creates and runs a project; it adds no content
  features of its own. Features of the API belong in Django Headless,
  features of the admin in Django Content Studio. DjangoStack only
  configures and connects them. When it needs something from them, the
  change goes to their repository, not a workaround here.
- **The project is the user's**: everything `init` writes is plain Django,
  Astro or Next.js code and a plain `compose.yaml` that works without the
  CLI. `dstack` is a convenience, never the only way to run, build or
  deploy a project.
- **Secure by default**: generated API routes stay closed, the frontend
  gets the read-only key only, secrets are generated, and every relaxation
  is an explicit setting with a system check.

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
- `website/`: the Docusaurus docs, published to GitHub Pages by the
  `docs-deploy.yml` workflow. `website/STYLE.md` is the writing style
  guide.
- `CHANGELOG.md`: the release notes, one version for every npm and PyPI
  package.

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

Run the checks of every part you changed before you commit.

## Rules

- Production containers are read-only and run without privileges. A
  service that needs to write gets a volume or `/tmp`, never a writable
  image.
- Every CLI prompt has a flag, and every command exits non-zero with a
  one-line reason on failure.
- A change to `templates/` must keep existing projects working, or say in
  the changelog what to change in them.
- Commit messages, docs, the changelog and code comments are in English.

## Writing documentation

All user-facing text (the docs website, the README, the CLI's help and
messages, and the changelog's voice and terminology) follows the writing
style guide in `website/STYLE.md`: read it before writing or editing any of
them. In short: address the reader as "you", never "we"; plain and precise,
no hype, no exclamation marks; **DjangoStack** in one word, **Django
Headless** and **Django Content Studio** in full; say what DjangoStack
configures and link to the sibling projects' docs for the rest; no roadmap
promises and no version history in prose ("new in", "formerly"); complete,
runnable examples with the file path first.

Update the docs in the same change as the behavior: a new or changed
command, flag, environment variable, setting or generated file is
documented before the change is done. When the guide and a page disagree,
the guide wins: fix the page.

## Commit messages

- One line in the imperative mood and sentence case, without a prefix, a
  scope or a final period: `Add dstack deploy with a Coolify provider`,
  `Back up the media volume with the database`. No `feat:`, `fix:` or
  `chore(cli):`.
- Name the change as a user sees it, not the files: `Check Docker, Node.js
  and Python in init`, not `Update tools.ts`.
- One change per commit. A body is optional; when the reason is not
  obvious from the diff, add one with why, wrapped at 72 characters.
- `Release vX.Y.Z` commits are made by the Release workflow only.

## Changelog

`CHANGELOG.md` has one version for every npm and PyPI package. The next
version is the `## X.Y.Z (unreleased)` heading at the top.

- Add an entry under the unreleased heading in the same change, for every
  change a user notices: a command, a flag, a template, a setting, a
  package's API, a fix. Internal refactors, tests, CI and docs-only fixes
  get none.
- If there is no unreleased heading, add one above the last release with
  the next version: a minor bump when it has a feature, a patch for fixes
  only. There is only ever one unreleased heading. Never date it or edit a
  released version; the Release workflow dates it.
- A feature is a bullet that starts with a short bold title ending in a
  period, then what changed for the user in full sentences:
  `- **Media backups.** When uploads are on the server's disk, ...`. Name
  the commands, flags and environment variables in code font, say what the
  user does and what happens, and how to turn it off when that matters.
- Fixes go under a `### Fixes` heading after the features, one bullet each,
  starting with `Fixed:` and the wrong behavior, then what happens now:
  `- Fixed: dstack backup exited 0 when pg_dump failed; it now exits 1.`
- Breaking changes and anything a user must do in an existing project
  (a `compose.yaml` edit, a new environment variable) say so in the entry,
  with the exact change.
- Write it for the people who use DjangoStack, in the voice of
  `website/STYLE.md`: "you", plain and precise. Unlike the docs, the
  changelog records history, so "was" and "now" are fine.
- Change an entry that is still unreleased rather than adding a second
  one for the same feature.

## Releases

Run the **Release** workflow (`release.yml`) by hand from `main`; it takes
no input and releases the version of the unreleased heading. It requires
green CI on `main` and exactly one unreleased heading, sets the version
everywhere with `scripts/bump_version.py`, dates the heading, commits,
pushes the tag `vX.Y.Z`, publishes to npm and PyPI through trusted
publishing and creates the GitHub Release with the changelog section as
notes. `X.Y.Z-rc.N` is published under the npm tag `next` and as a
prerelease. Its pushes use `GITHUB_TOKEN` and trigger no other workflows,
so anything a release needs is a job in `release.yml`.
