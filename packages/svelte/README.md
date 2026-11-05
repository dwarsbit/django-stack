# @django-stack/svelte

Svelte components for DjangoStack frontends: blocks, rich text, images and
SEO tags, for content from Django Headless and Django Content Studio.

Part of [DjangoStack](https://github.com/dwarsbit/django-stack). The
SvelteKit frontend of `npx @django-stack/cli init --frontend sveltekit`
uses it.

```svelte
<!-- src/routes/[...path]/+page.svelte -->
<script lang="ts">
  import { Blocks } from "@django-stack/svelte";
  import Gallery from "$lib/components/Gallery.svelte";

  let { data } = $props();
</script>

<h1>{data.page.title}</h1>
<Blocks blocks={data.page.body} components={{ gallery: Gallery }} />
```

| Component | What it renders |
|-----------|-----------------|
| `Blocks` | A block field. `components` adds or replaces block types; unknown types render nothing. |
| `RichText` | HTML from an `HTMLField`, which Django sanitizes when it is saved. |
| `Image` | A responsive `<img>` with `srcset` from the image sizes and the focal point. |
| `Seo` | The title, description, canonical URL, Open Graph and Twitter tags, in `<svelte:head>`. |

## License

MIT
