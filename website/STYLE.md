# Writing style guide

How the DjangoStack documentation, the docs website and the README are
written: the voice, the words, and what they do and do not mention. It
applies to every user-facing text in this repository, and to anyone writing
it, people and AI agents alike. It follows the style guides of Django
Headless and Django Content Studio, so the three sites read as one. The
changelogs follow the voice and terminology rules, but they record history,
so the rules on what not to mention do not apply to them.

When this guide and an existing page disagree, the guide wins: fix the page.

## 1. Voice and tone

**Talk to the reader as "you". Never write "we".** The project is
"DjangoStack", not "we" or "us".

| Do | Don't |
|----|-------|
| `init` writes `.env` with fresh secrets. | We generate the secrets for you. |
| DjangoStack configures Django Headless and Django Content Studio. | We set up the API and the admin. |

**Plain and precise.** Write like the Django documentation: calm, factual,
specific. Explain *why* when the reason helps the reader decide or avoid a
mistake. No hype, no exclamation marks, no filler.

| Do | Don't |
|----|-------|
| Run `docker compose up` and open http://localhost:3000. | That's it! 🎉 Your site is live! |
| Caddy gets and renews the certificate. | Blazing-fast, secure hosting out of the box. |

Avoid these words: *simply, just, easy, easily, quickly, instant(ly),
obviously, of course, powerful, seamless(ly), blazing, magic(al), amazing,
awesome, robust, cutting-edge, leverage, utilize*. They promise or judge
instead of inform.

**State limitations and risks plainly, with the fix.** Do not soften them
and do not alarm. Every caveat says what to do about it.

> Do: Caddy needs the DNS record before the first start to get the
> certificate; create it first.
>
> Don't: HTTPS might not work in some setups.

## 2. Spelling and mechanics

- **American English**: customize, behavior, color, license (noun and verb),
  canceled.
- **Sentence case** for every heading: "Deploy to a server", "Media and
  database", not "Media and Database".
- **Em dashes sparingly**: at most one per paragraph. Prefer a period, a
  colon or parentheses. Never use an em dash where a comma works.
- **Short paragraphs**: about four sentences at most, one idea each. Lead
  with the point; details follow.
- **Lists** for three or more parallel items; a sentence for two.
- **Procedures** are numbered steps in the imperative ("Run…", "Set…",
  "Open…"), one action per step.
- **Code font** for anything you type or read in code: commands
  (`docker compose up`), CLI commands and flags (`init`, `--frontend`),
  environment variables (`API_READ_KEY`), settings
  (`DJANGO_STACK["PUBLIC_CREATE"]`), file and directory names
  (`compose.yaml`, `backend/`), Compose services (`backend-prod`), headers
  (`X-Secret-Key`) and literal values (`astro`, `"10/min"`).
- **Bold** only for a lead-in term in a list item, a button label in the
  admin (**Preview**), or a warning-level word. Do not bold for emphasis in
  running text.
- **Admonitions** (`:::note`, `:::warning`) for information the reader must
  not miss; at most one or two per page.
- **Links**: link the first mention of a setting, page or concept on a page;
  link text says where it goes ("see the [CLI reference](./cli.md)"), never
  "click here". Pages link to each other with relative file links; the
  README links to `https://dwarsbit.github.io/django-stack/docs/…`.

## 3. Emoji

One emoji per **page title**, unique across the site, for recognition in the
sidebar. No emoji anywhere else: not in section headings, body text, lists,
admonitions or the README.

## 4. Terminology

### The product

- **DjangoStack**, one word, in running text.
- **`@django-stack/cli`**, **`@django-stack/utils`** and the other npm
  packages, and **`django-stack`** on PyPI, in code font only as package
  names.
- **`django-stack`** in code font also as the command a project installs
  (`django-stack doctor`).
- Never *DS*, *Django Stack* (two words) or *the boilerplate*.

### What DjangoStack creates

- **project**: the directory `init` creates, with its backend, frontend and
  `compose.yaml`.
- **site**: the website the project serves to visitors.
- **backend**: the Django project in `backend/`.
- **frontend**: the Astro or Next.js app in `frontend/`. Name the framework
  when the text applies to one only.
- **the API**: Django Headless's REST API under `/api/`.
- **the admin**: Django Content Studio's interface under `/admin/`.
- **service**: a Docker Compose service (`backend`, `db`, `proxy`).
- **starter content model**: the models `init` puts in `backend/content/`.

### The sibling projects

- **Django Headless** and **Django Content Studio**, always the full name.
- Features of the API belong to Django Headless and features of the admin to
  Django Content Studio. Say what DjangoStack configures and link to their
  documentation for the rest; do not explain them again.

### People

- **you**: the reader, a developer who creates, changes and deploys a
  project.
- **editors**: the people who write and publish content in the admin.
- **visitors**: the people who read the site.
- Not *end users*, *customers* or *admins* for any of them.

### Glossary

| Use | Not |
|-----|-----|
| project | app, repo, boilerplate, scaffold |
| create a project | scaffold, bootstrap, generate a project |
| site | website app, the frontend (when the whole site is meant) |
| the admin | CMS, dashboard, back office, Content Studio UI |
| the API | the backend (when the API is meant), endpoint |
| route (`/api/content.page`) | endpoint |
| service | container (unless the container itself is meant) |
| environment variable (`SITE_URL`) | env var, config option |
| setting (`DJANGO_STACK["…"]`) | config option, parameter |
| flag (`--frontend`) | switch, parameter |
| system check | validation, lint |
| log in / log out (verb), login (noun, adjective) | sign in / sign out, login (as a verb) |
| production, development | prod, dev (except in names such as the `prod` profile) |

## 5. What to mention, and what not

### Never mention

- **Implementation details.** Describe what DjangoStack does for the
  reader, not how the CLI or the packages are built.
- **The internal API.** Only what a project uses: the CLI and its flags, the
  documented environment variables and settings, and the exports of the npm
  and PyPI packages. Examples never import anything else.
- **Roadmap promises.** No "coming soon", dates or versions. What does not
  ship yet appears only in the Status section of the introduction, and as
  "not available yet" where a flag or option already exists.
- **Version history in prose.** No "formerly", "used to", "since 0.2",
  "new in", "previously". History belongs in the changelog.

### Mention, with care

- **The tools in a project** (Django, Astro, Next.js, Postgres, Valkey,
  Caddy, Mailpit, Docker Compose): freely, since the reader works with them.
  Link to their documentation for their concepts rather than explaining
  them again.
- **Hosting platforms** (Coolify, Dokploy, a VPS provider): only on the
  pages that deploy to them, factually.
- **Other tools** (WordPress, other CMSs and starters): only on a single
  comparison page, factually and without judging them. Nowhere else.

## 6. Code examples

- **Complete and runnable.** Every command and snippet works as-is in a
  project `init` created. If a snippet is a fragment of a larger file, say
  so in the text before it.
- **File path first.** Start each code snippet with a comment naming the
  file: `# backend/content/models.py`, `// frontend/src/pages/index.astro`.
- **Commands** in a `bash` block, run from the project directory unless the
  text says otherwise. No `$` prompt.
- **One example project**: `my-site`, created with
  `npx @django-stack/cli init my-site`, deployed at `https://example.com`.
  Content examples use the starter content model: pages, posts, menus and
  site settings.
- **Real values.** Realistic names and values (`"About us"`, `"10/min"`),
  not `foo`, `bar` or `my_field`. Secrets as placeholders that read as such:
  `your-secret-key`.
- **Formatted** like the codebase: Ruff for Python, Biome for JavaScript and
  TypeScript, double quotes.

## 7. Page structure

1. **Title** with the page's emoji, in sentence case.
2. **Opening paragraph**: what the page covers and when you need it, in two
   or three sentences.
3. **The common case first**, with a complete example.
4. **Options and variations** after, most used first.
5. **Caveats** where they apply, each with its fix.
6. **Related pages** at the end when useful, as plain links.

The README follows the same voice and terminology. It covers what
DjangoStack is, the command that creates a project, how to work on this
repository, and links into the documentation; everything else lives on the
docs website.
