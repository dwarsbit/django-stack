# @django-stack/cli

## 0.1.0

### Minor Changes

- be635b1: CLI: commands are built with Commander, so every command has `--help`, typos get a suggestion and invalid values fail with one line. The output has colors, `init` asks for the backend's time zone (`--time-zone`) with a list you filter by typing and picks the extras in one list, and `completion <shell>` prints a Tab completion script. Each command checks npm once a day for a newer version and shows a notice; turn it off with `--no-update-check` or `DJANGO_STACK_NO_UPDATE_CHECK=1`.
- a6ab876: The CLI's command is now `dstack` (it was `django-stack`). When you run it with `npx`, `pnpm dlx` or `bunx`, it offers once to install `dstack` globally with the same package manager, remembers the answer, and explains a permission error instead of failing. Turn the offer off with `--no-install-prompt` or `DJANGO_STACK_NO_INSTALL_PROMPT=1`.
- 8a5410b: First release: `django-stack init` creates a Docker Compose project with a Django backend (Django Headless and Django Content Studio), an Astro frontend, Postgres, Valkey and Mailpit, with a starter content model, demo content, preview and revalidation. `django-stack doctor` checks a project. `@django-stack/utils` has the typed content client, the preview and webhook signatures, and the image and SEO helpers.
- 1efb894: `init` asks for every stack option, each with a flag: `--frontend`, `--postgres`, `--analytics`, `--tasks`, `--cache`, `--notifications`, `--captcha`, `--storage` and `--package-manager`. `--preset <code>` sets them all at once, `init` prints the preset of the project it created, and `django-stack preset` makes or reads a code. There are named presets: `blog`, `api` and `minimal`. Values this release does not generate yet are listed but refused. `--local-s3` is now `--storage s3`; the old flag still works.
- 92a2e6d: Production: the `production` command writes `.env.production` for a server, `doctor` checks the prod profile, and `init --local-s3` adds a local S3 service. New projects run in production behind Caddy with HTTPS, hardened containers, daily database backups and an optional GitHub Actions deploy workflow.
