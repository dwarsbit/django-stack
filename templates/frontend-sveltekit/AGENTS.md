# The SvelteKit frontend

SvelteKit renders the site on the server (`@sveltejs/adapter-node`). Content
is loaded in `+page.server.ts` and `+layout.server.ts` only, so the API key
stays on the server. The project's `AGENTS.md` describes the whole project;
this file describes the frontend.

## Layout

```
src/routes/                  routes: /, /[...path], /blog, /blog/[slug], /category/[slug], /tag/[slug], sitemap.xml, rss.xml, robots.txt, /preview, /revalidate
src/routes/+layout.svelte    the page shell: SEO tags, menus, footer, preview banner
src/lib/components/          the post list and the contact form
src/lib/server/api.ts        getContent(): content helpers with the read-only key, drafts in preview
src/lib/server/cache.ts      the in-memory page cache that /revalidate empties
src/lib/headless.ts          generated API types; do not edit, run `npm run generate:types`
src/hooks.server.ts          page cache, editor-managed redirects, security headers
vite.config.ts               SvelteKit's options (Node adapter, Content-Security-Policy) and the dev proxy to Django
```

Blocks, rich text, images and SEO tags come from `@django-stack/svelte`.

## Read a content model

```ts
// src/routes/events/+page.server.ts
import { getClient } from "#lib/server/api.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => ({
  events: await getClient(cookies).model("content.event").list(),
});
```

Never import `#lib/server` from a component or a universal `+page.ts`.

## Render a block type

Add a component in `src/lib/components/blocks/` that takes a `block` prop,
and pass it to `Blocks` by the block's type:

```svelte
<Blocks blocks={data.page.body} components={{ gallery: Gallery }} />
```

## Commands

Run them in the `frontend` container (`docker compose exec frontend <command>`):

| Task | Command |
|------|---------|
| Type-check | `npm run check` |
| Test | `npm test` |
