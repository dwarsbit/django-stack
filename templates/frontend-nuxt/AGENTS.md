# The Nuxt frontend

Nuxt renders the site on the server (Nitro's `node-server` preset). Pages
never call Django: they load content with `useFetch` from the server routes
in `server/routes/_content/`, which hold the read-only API key, so the key
never reaches the browser. The project's `AGENTS.md` describes the whole
project; this file describes the frontend.

## Layout

```
src/pages/                   routes: /, /[...path], /blog, /blog/[slug], /category/[slug], /tag/[slug]
src/layouts/default.vue      the page shell: menus, footer, preview banner
src/components/              the post list and the contact form
src/composables/             useContent() loads from server/routes/_content and follows redirects; usePageSeo() sets the SEO tags
src/lib/headless.ts          generated API types; do not edit, run `npm run generate:types`
server/routes/_content/      the content the pages load, cached in memory
server/routes/               sitemap.xml, rss.xml, robots.txt, /preview, /revalidate
server/utils/content.ts      getContent(): content helpers with the read-only key, drafts in preview
server/utils/cache.ts        the in-memory cache that /revalidate empties
server/plugins/              the media origins in the Content-Security-Policy
nuxt.config.ts               security headers (nuxt-security), the dev proxy to Django
```

Blocks, rich text and images come from `@django-stack/vue`.

## Read a content model

Add a server route, then load it in a page:

```ts
// server/routes/_content/events.get.ts
export default defineEventHandler((event) =>
  cachedContent(event, () => getClient(event).model("content.event").list()),
);
```

```vue
<!-- src/pages/events.vue -->
<script setup lang="ts">
const { data: events } = await useContent("/_content/events");
</script>
```

Never call `getClient()` or `getContent()` outside `server/`, and never
put a route in `server/api/`: Django owns `/api`.

## Render a block type

Add a component in `src/components/blocks/` that takes a `block` prop, and
pass it to `Blocks` by the block's type:

```vue
<Blocks :blocks="page.body" :components="{ gallery: Gallery }" />
```

## Commands

Run them in the `frontend` container (`docker compose exec frontend <command>`):

| Task | Command |
|------|---------|
| Type-check | `npm run check` |
| Test | `npm test` |
