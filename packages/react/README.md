# @django-stack/react

React components for DjangoStack frontends: blocks, rich text and images, for
content from Django Headless and Django Content Studio, and the captcha
widget. All but `Captcha` work in server components.

Part of [DjangoStack](https://github.com/dwarsbit/django-stack). The Next.js
frontend of `npx @django-stack/cli init --frontend next` uses it.

```tsx
// src/app/about/page.tsx
import { Blocks } from "@django-stack/react";
import { Gallery } from "@/components/Gallery";
import { getContent } from "@/lib/api";

export default async function About() {
  const page = await (await getContent()).getPage("about");
  return (
    <article>
      <h1>{page?.title}</h1>
      <Blocks blocks={page?.body} components={{ gallery: Gallery }} />
    </article>
  );
}
```

| Component | What it renders |
|-----------|-----------------|
| `Blocks` | A block field. `components` adds or replaces block types; unknown types render nothing. |
| `RichText` | HTML from an `HTMLField`, which Django sanitizes when it is saved. |
| `Image` | A responsive `<img>` with `srcset` from the image sizes and the focal point. |
| `Captcha` | The captcha widget, inside a `<form>` that posts to a model in `PUBLIC_CREATE`; it adds a hidden `captcha` field with the token. In a client component. |

For the SEO tags in Next.js, pass the result of `seo()` from
`@django-stack/utils` to `toMetadata()` of `@django-stack/next`.

## License

MIT
