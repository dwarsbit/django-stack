<script setup lang="ts">
import { Blocks, Image } from "@django-stack/vue";
import type { Author, Taxonomy } from "@django-stack/utils";

const route = useRoute();
const { data: post } = await useContent(`/_content/post/${route.params.slug}`);
usePageSeo(post, "article");

const author = computed(() => (typeof post.value?.author === "object" ? (post.value.author as Author | null) : null));
const categories = computed(() => (post.value?.categories ?? []).filter((item): item is Taxonomy => typeof item === "object"));
const tags = computed(() => (post.value?.tags ?? []).filter((item): item is Taxonomy => typeof item === "object"));
const date = computed(() => (post.value?.published_at ? new Date(post.value.published_at) : null));
</script>

<template>
  <article v-if="post" class="narrow">
    <p class="muted">
      <time v-if="date" :datetime="date.toISOString()">{{ date.toLocaleDateString("en", { dateStyle: "long" }) }}</time>
      <span v-if="author"> · {{ author.name }}</span>
      <span v-for="category in categories" :key="category.slug">
        · <NuxtLink :to="`/category/${category.slug}`">{{ category.name }}</NuxtLink>
      </span>
    </p>
    <h1>{{ post.title }}</h1>
    <Image :media="post.cover" size="content" sizes="(min-width: 48rem) 44rem, 100vw" class="cover" eager />
    <Blocks :blocks="post.body" />
    <p v-if="tags.length > 0" class="tags">
      <NuxtLink v-for="tag in tags" :key="tag.slug" :to="`/tag/${tag.slug}`">#{{ tag.name }}</NuxtLink>
    </p>
  </article>
</template>

<style scoped>
article :deep(.cover) {
  width: 100%;
  border-radius: 0.75rem;
}
.tags {
  display: flex;
  gap: 1rem;
  margin-top: 3rem;
}
</style>
