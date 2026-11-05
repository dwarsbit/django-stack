<script setup lang="ts">
import { Blocks } from "@django-stack/vue";

const route = useRoute();
const path = computed(() => ([] as string[]).concat(route.params.path ?? []).join("/"));
const { data: page } = await useContent("/_content/page", () => ({ path: path.value }));
usePageSeo(page);
</script>

<template>
  <article v-if="page" class="narrow">
    <h1>{{ page.title }}</h1>
    <Blocks :blocks="page.body" />
    <ContactForm v-if="page.path === 'contact'" />
  </article>
</template>
