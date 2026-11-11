<script setup lang="ts">
import { Image, RichText } from "@django-stack/vue";
import { linkHref, safeHref } from "@django-stack/utils";

const { data } = await useLayoutContent();
const route = useRoute();
const isCurrent = (href: string) => href === route.path || (href !== "/" && route.path.startsWith(`${href}/`));

useHead(() => ({
  link: [
    { rel: "alternate", type: "application/rss+xml", title: data.value?.settings?.site_name ?? "RSS", href: "/rss.xml" },
  ],
  script: data.value?.analytics
    ? [{ src: "/_a/script.js", defer: true, "data-website-id": data.value.analytics }]
    : [],
}));
</script>

<template>
  <div v-if="data?.preview" class="preview-banner">
    Preview: drafts are shown. <a href="/preview/exit">Leave preview</a>
  </div>
  <header class="site-header">
    <div class="container bar">
      <NuxtLink class="brand" to="/">
        <Image v-if="data?.settings?.logo" :media="data.settings.logo" size="thumbnail" :alt="data.settings.site_name" eager />
        <template v-else>{{ data?.settings?.site_name }}</template>
      </NuxtLink>
      <nav aria-label="Main">
        <NuxtLink
          v-for="item in data?.mainMenu?.items ?? []"
          :key="item.id"
          :to="linkHref(item)"
          :aria-current="isCurrent(linkHref(item)) ? 'page' : undefined"
        >
          {{ item.value.label }}
        </NuxtLink>
      </nav>
    </div>
  </header>
  <main>
    <slot />
  </main>
  <footer class="site-footer">
    <div class="container bar muted">
      <RichText :html="data?.settings?.footer_text" class="footer-text" />
      <nav aria-label="Footer">
        <NuxtLink v-for="item in data?.footerMenu?.items ?? []" :key="item.id" :to="linkHref(item)">
          {{ item.value.label }}
        </NuxtLink>
        <a v-for="(url, name) in data?.settings?.social_links ?? {}" :key="name" :href="safeHref(String(url))" rel="me">{{ name }}</a>
      </nav>
    </div>
  </footer>
</template>

<style scoped>
.site-header {
  border-bottom: 1px solid var(--color-line);
}
.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  padding-block: 1rem;
}
.brand {
  font-weight: 700;
  font-size: 1.2rem;
  color: inherit;
  text-decoration: none;
}
.brand :deep(img) {
  height: 2.5rem;
  width: auto;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
}
nav a {
  text-decoration: none;
}
nav a[aria-current="page"] {
  font-weight: 600;
  text-decoration: underline;
}
main {
  min-height: 70vh;
  padding-block: 2rem 4rem;
}
.site-footer {
  border-top: 1px solid var(--color-line);
  font-size: 0.9rem;
}
.site-footer :deep(.footer-text p) {
  margin: 0;
}
</style>
