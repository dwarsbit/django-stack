# Contributing

1. Fork the repository and create a branch.
2. Make the change and add tests for it.
3. Run the checks: `pnpm lint`, `pnpm build`, `pnpm typecheck`, `pnpm test`,
   and in `python/django-stack` `uv run ruff check .` and `uv run pytest`.
4. For a change to an npm package, add a changeset with `pnpm changeset`.
5. Open a pull request.

## Releases

- **npm**: the four packages share one version. Merging changesets into
  `main` opens a "Version packages" pull request; merging that publishes
  every package to npm with provenance.
- **PyPI**: bump `version` in `python/django-stack/pyproject.toml` and
  `django_stack/__init__.py`, merge, then push a tag `python-v<version>`.
  The release workflow publishes through PyPI trusted publishing.

## Where a change belongs

DjangoStack is glue. A feature of the content API belongs in
[Django Headless](https://github.com/dwarsbit/django-headless), and a
feature of the admin in
[Django Content Studio](https://github.com/dwarsbit/django-content-studio).

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
   `release.yml`, environment `pypi`. Then push the tag `python-v0.0.1`.
