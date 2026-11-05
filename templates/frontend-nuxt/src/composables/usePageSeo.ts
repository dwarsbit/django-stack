import { type SeoInput, seo } from "@django-stack/utils";
import type { MaybeRefOrGetter } from "vue";

/**
 * The title, description, canonical URL, Open Graph and Twitter tags of a
 * page. It awaits nothing, so call it anywhere in `<script setup>`.
 */
export function usePageSeo(
  page: MaybeRefOrGetter<SeoInput | null | undefined>,
  type?: "website" | "article",
) {
  const route = useRoute();
  // The layout loads the same data under the same key: this does not fetch again.
  const { data: layout } = useLayoutContent();
  const meta = computed(() =>
    seo({
      page: toValue(page),
      settings: layout.value?.settings ?? null,
      siteUrl: layout.value?.siteUrl ?? "",
      path: route.path,
      type,
    }),
  );
  useHead(() => ({
    title: meta.value.title,
    link: [{ rel: "canonical", href: meta.value.canonical }],
    meta: [
      ...(meta.value.description ? [{ name: "description", content: meta.value.description }] : []),
      ...Object.entries(meta.value.openGraph).map(([property, content]) => ({ property, content })),
      ...Object.entries(meta.value.twitter).map(([name, content]) => ({ name, content })),
    ],
  }));
}
