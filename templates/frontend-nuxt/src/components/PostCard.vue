<script setup lang="ts">
import { Image } from "@django-stack/vue";
import type { Author, Post } from "@django-stack/utils";

const props = defineProps<{ post: Post }>();
const author = computed(() => (typeof props.post.author === "object" ? (props.post.author as Author | null) : null));
const date = computed(() => (props.post.published_at ? new Date(props.post.published_at) : null));
</script>

<template>
  <article class="card">
    <NuxtLink :to="`/blog/${post.slug}`">
      <Image :media="post.cover" size="card" sizes="(min-width: 40rem) 22rem, 100vw" class="cover" />
    </NuxtLink>
    <h3><NuxtLink :to="`/blog/${post.slug}`">{{ post.title }}</NuxtLink></h3>
    <p class="muted meta">
      <time v-if="date" :datetime="date.toISOString()">{{ date.toLocaleDateString("en", { dateStyle: "medium" }) }}</time>
      <span v-if="author"> · {{ author.name }}</span>
    </p>
    <p v-if="post.excerpt">{{ post.excerpt }}</p>
  </article>
</template>

<style scoped>
.card h3 {
  margin: 0.75rem 0 0.25rem;
  line-height: 1.3;
}
.card h3 a {
  color: inherit;
  text-decoration: none;
}
.card :deep(.cover) {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 0.5rem;
}
.meta {
  font-size: 0.9rem;
  margin: 0;
}
</style>
