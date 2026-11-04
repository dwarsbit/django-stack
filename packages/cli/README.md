# @django-stack/cli

Create and manage DjangoStack projects: a Django backend, a frontend, Postgres and Docker Compose in one command.

```bash
npx @django-stack/cli init my-site
cd my-site
docker compose up
```

| Command | Description |
|---------|-------------|
| `init [directory]` | Create a project. Flags: `--name`, `--frontend`, `--database-url`, `--no-demo-content`, `--no-git`, `--start`, `--yes` |
| `doctor [directory]` | Check a project and its running services |
| `secret [bytes]` | Print a random secret |

Read the [documentation](https://github.com/dwarsbit/django-stack/tree/main/website/docs) of
[DjangoStack](https://github.com/dwarsbit/django-stack).

## License

MIT
