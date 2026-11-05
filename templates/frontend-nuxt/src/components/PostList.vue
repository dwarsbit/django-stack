<script setup lang="ts">
import type { Paginated, Post } from "@django-stack/utils";

const props = defineProps<{
  result: Paginated<Post>;
  /** The URL of the list, without the page parameter. */
  base: string;
}>();
const current = computed(() => props.result.pagination.current);
const pages = computed(() => props.result.pagination.pages);
const pageUrl = (page: number) => (page === 1 ? props.base : `${props.base}?page=${page}`);
</script>

<template>
  <p v-if="result.data.length === 0" class="muted">No posts yet.</p>
  <div class="grid">
    <PostCard v-for="post in result.data" :key="post.id" :post="post" />
  </div>
  <nav v-if="pages > 1" class="pagination" aria-label="Pages">
    <NuxtLink v-if="current > 1" :to="pageUrl(current - 1)">← Newer</NuxtLink>
    <span class="muted">Page {{ current }} of {{ pages }}</span>
    <NuxtLink v-if="current < pages" :to="pageUrl(current + 1)">Older →</NuxtLink>
  </nav>
</template>

<style scoped>
.pagination {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  margin: 3rem 0;
}
</style>
