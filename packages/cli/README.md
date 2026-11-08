# @django-stack/cli

The production-ready Django, batteries included stack. Create and manage DjangoStack projects: a Django backend, a frontend, Postgres and Docker Compose in one command.

```bash
npx @django-stack/cli init my-site
cd my-site
docker compose up
```

| Command | Description |
|---------|-------------|
| `init [directory]` | Create a project. Flags: `--name`, `--preset`, `--frontend`, `--postgres`, `--analytics`, `--tasks`, `--cache`, `--notifications`, `--captcha`, `--storage`, `--package-manager`, `--database-url`, `--time-zone`, `--no-demo-content`, `--no-git`, `--start`, `--yes` |
| `production [directory]` | Write `.env.production` for a server. Flags: `--domain`, `--email-url`, `--force`, `--yes` |
| `preset [preset]` | Print the preset code of a stack, or the stack of a code |
| `doctor [directory]` | Check a project and its running services |
| `self-update` | Update `dstack` to the latest version, with the package manager that installed it |
| `secret [bytes]` | Print a random secret |
| `completion <shell>` | Print a Tab completion script for zsh, bash, fish or PowerShell |

The command is `dstack`. The first time you run the CLI with `npx`, it
offers to install `dstack` globally; or run
`npm i -g @django-stack/cli` yourself. Turn the offer off with
`--no-install-prompt` or `DJANGO_STACK_NO_INSTALL_PROMPT=1`.

Run `dstack help <command>` for the options of a command. Each command
checks for a newer version once a day; turn that off with
`--no-update-check` or `DJANGO_STACK_NO_UPDATE_CHECK=1`.

Read the [documentation](https://djangostack.org/) of
[DjangoStack](https://github.com/dwarsbit/django-stack).

## License

MIT
