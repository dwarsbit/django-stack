# The Next.js frontend

Next.js renders the site on the server with the App Router. Content is
loaded in server components and route handlers only, through `src/lib/api.ts`,
so the API key stays on the server. The project's `AGENTS.md` describes the
whole project; this file describes the frontend.

## Layout

```
src/app/                 routes: /, /[...path], /blog, /blog/[slug], /category/[slug], /tag/[slug], sitemap.xml, rss.xml, robots.txt, /preview, /revalidate
src/app/layout.tsx       the page shell: menus, footer, preview banner
src/components/          the post list, the menu links and the contact form
src/lib/api.ts           getContent(): content helpers with the read-only key, drafts in preview; pageMetadata()
src/lib/headless.ts      generated API types; do not edit, run `npm run generate:types`
src/proxy.ts             Content-Security-Policy with a nonce, security headers, the dev proxy to Django
next.config.ts           standalone output, the in-memory data cache
```

Blocks, rich text and images come from `@django-stack/react`; the
`/preview` and `/revalidate` handlers, the metadata and the
Content-Security-Policy from `@django-stack/next`.

API responses are kept in Next's data cache with the tag `content` for
`CACHE_TTL` seconds (default 300). `/revalidate` expires the tag when
editors publish. Previews and the dev server skip the cache.

## Read a content model

```tsx
// src/app/events/page.tsx
import { getClient } from "@/lib/api";

export default async function Events() {
  const events = await (await getClient()).model("content.event").list();
  return <ul>{events.data.map((event) => <li key={event.id}>{event.title}</li>)}</ul>;
}
```

`src/lib/api.ts` imports `server-only`: a client component (`"use client"`)
that imports it fails the build.

## Render a block type

Add a component that takes a `block` prop, and pass it to `Blocks` by the
block's type:

```tsx
<Blocks blocks={page.body} components={{ gallery: Gallery }} />
```

## Commands

Run them in the `frontend` container (`docker compose exec frontend <command>`):

| Task | Command |
|------|---------|
| Type-check | `npm run check` |
| Test | `npm test` |
