---
"@django-stack/cli": minor
---

The CLI's command is now `dstack` (it was `django-stack`). When you run it with `npx`, `pnpm dlx` or `bunx`, it offers once to install `dstack` globally with the same package manager, remembers the answer, and explains a permission error instead of failing. Turn the offer off with `--no-install-prompt` or `DJANGO_STACK_NO_INSTALL_PROMPT=1`.
