# @django-stack/next

Next.js glue for [DjangoStack](https://github.com/dwarsbit/django-stack):

- `revalidateHandler()`, `previewHandler()` and `exitPreviewHandler()`: the
  route handlers of `/revalidate`, `/preview` and `/preview/exit`;
- `contentFetchInit()`: the `fetch` options that put API responses in Next's
  data cache with a tag `/revalidate` expires;
- `toMetadata()`: Next metadata from `seo()` of `@django-stack/utils`;
- `contentSecurityPolicy()`, `mediaOrigins()` and `SECURITY_HEADERS`: the
  response headers `proxy.ts` sets.

The components are in `@django-stack/react`.

```ts
// src/app/revalidate/route.ts
import { revalidateHandler } from "@django-stack/next";

export const POST = revalidateHandler();
```

## License

MIT
