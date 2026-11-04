---
"@django-stack/cli": minor
---

CLI: commands are built with Commander, so every command has `--help`, typos get a suggestion and invalid values fail with one line. The output has colors, `init` asks for the backend's time zone (`--time-zone`) with a list you filter by typing and picks the extras in one list, and `completion <shell>` prints a Tab completion script. Each command checks npm once a day for a newer version and shows a notice; turn it off with `--no-update-check` or `DJANGO_STACK_NO_UPDATE_CHECK=1`.
