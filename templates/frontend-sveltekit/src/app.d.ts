// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SeoInput } from "@django-stack/utils";

declare global {
  namespace App {
    interface PageData {
      /** The page's title, description and share image, for the SEO tags in the layout. */
      seo?: SeoInput | null;
      seoType?: "website" | "article";
    }
  }
}
