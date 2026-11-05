<script setup lang="ts">
import { Blocks } from "@django-stack/vue";

const { data } = await useContent("/_content/home");
usePageSeo(() => data.value?.home);
</script>

<template>
  <article v-if="data?.home" class="narrow">
    <h1>{{ data.home.title }}</h1>
    <Blocks :blocks="data.home.body" />
  </article>
  <section v-else class="container">
    <h1>{{ data?.settings?.site_name ?? "Latest posts" }}</h1>
    <p v-if="data?.settings?.tagline" class="muted">{{ data.settings.tagline }}</p>
    <PostList v-if="data?.posts" :result="data.posts" base="/" />
  </section>
</template>
