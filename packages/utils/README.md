# @django-stack/utils

Framework-agnostic helpers for DjangoStack frontends: the API client, content helpers, SEO, images and webhooks.

```ts
import { createClient, createContent, imageAttributes, seo } from "@django-stack/utils";

// Server only: reads API_URL and API_READ_KEY from the environment.
const content = createContent(createClient());
const page = await content.getPage("about/team");
const posts = await content.getPosts({ category: "news", page: 2 });
```

- `createClient()`: the [Django Headless client](https://djangoheadless.org), configured from the environment, with preview support. It refuses to run in a browser with a key.
- `createContent()`: pages by path, posts, taxonomies, menus, site settings and redirects of the starter content model.
- `imageAttributes()`, `imageUrl()`: `src`, `srcset`, size and focal point of a media object.
- `seo()`: title, description, canonical URL and share image of a page.
- `signPreviewToken()`, `verifyPreviewToken()`, `verifyWebhook()`: the signatures shared with the `django-stack` Python package.

Part of [DjangoStack](https://github.com/dwarsbit/django-stack).

## License

MIT
