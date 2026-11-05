# Contributing

1. Fork the repository and create a branch.
2. Make the change and add tests for it.
3. Run the checks: `pnpm lint`, `pnpm build`, `pnpm typecheck`, `pnpm test`,
   and in `python/django-stack` `uv run ruff check .` and `uv run pytest`.
4. For a change users notice, add an entry under the unreleased version in
   `CHANGELOG.md`.
5. Open a pull request.

## Releases

The four npm packages and `django-stack` on PyPI share one version. The
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
