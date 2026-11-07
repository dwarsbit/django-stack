# @django-stack/vue

Vue components for DjangoStack frontends: blocks, rich text and images, for
content from Django Headless and Django Content Studio.

Part of [DjangoStack](https://github.com/dwarsbit/django-stack). The Nuxt
frontend of `npx @django-stack/cli init --frontend nuxt` uses it.

```vue
<!-- src/pages/[...path].vue -->
<script setup lang="ts">
import { Blocks } from "@django-stack/vue";
import Gallery from "~/components/Gallery.vue";

const { data: page } = await useFetch("/_content/page", { query: { path: "about" } });
</script>

<template>
  <h1>{{ page?.title }}</h1>
  <Blocks :blocks="page?.body" :components="{ gallery: Gallery }" />
</template>
```

| Component | What it renders |
|-----------|-----------------|
| `Blocks` | A block field. `components` adds or replaces block types; unknown types render nothing. |
| `RichText` | HTML from an `HTMLField`, which Django sanitizes when it is saved. |
| `Image` | A responsive `<img>` with `srcset` from the image sizes and the focal point. |
| `Captcha` | The captcha widget, inside a `<form>` that posts to a model in `PUBLIC_CREATE`; it adds a hidden `captcha` field with the token. |

For the SEO tags, pass the result of `seo()` from `@django-stack/utils` to
your framework's head manager, such as Nuxt's `useHead()`.

## License

MIT
