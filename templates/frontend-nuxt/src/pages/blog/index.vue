<script setup lang="ts">
const route = useRoute();
const { data: result } = await useContent("/_content/posts", () => ({ page: route.query.page }));
usePageSeo({ title: "Blog" });
</script>

<template>
  <section class="container">
    <h1>Blog</h1>
    <PostList v-if="result" :result="result" base="/blog" />
  </section>
</template>
