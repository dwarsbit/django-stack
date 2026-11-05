# The Astro frontend

Astro renders the site on the server (`output: "server"`, Node adapter).
The project's `AGENTS.md` describes the whole project; this file describes
the frontend.

## Layout

```
src/pages/             routes: /, /[...slug], /blog, /blog/[slug], /category/[slug], /tag/[slug], sitemap.xml, rss.xml, robots.txt, /preview, /revalidate
src/layouts/Base.astro the page shell: head, menus, footer, preview banner
src/components/        Blocks.astro maps block types to components in components/blocks/
src/lib/api.ts         getContent(): content helpers with the read-only key, drafts in preview
src/lib/cache.ts       the in-memory page cache that /revalidate empties
src/lib/headless.ts    generated API types; do not edit, run `npm run generate:types`
src/middleware.ts      page cache, editor-managed redirects, security headers
astro.config.mjs       server output, Content-Security-Policy, the dev proxy to Django
```

## Read a content model

```astro
---
// src/pages/events.astro
import { getClient } from "../lib/api";

const events = await getClient(Astro.cookies).model("content.event").list();
---
```

## Render a block type

Add a component in `src/components/blocks/` that takes a `block` prop, and
map the block's type to it in `src/components/Blocks.astro`.

## Commands

Run them in the `frontend` container (`docker compose exec frontend <command>`):

| Task | Command |
|------|---------|
| Type-check | `npm run check` |
| Test | `npm test` |
