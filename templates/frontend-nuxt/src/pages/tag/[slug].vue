<script setup lang="ts">
const route = useRoute();
const { data } = await useContent(`/_content/tag/${route.params.slug}`, () => ({ page: route.query.page }));
usePageSeo(() => ({ title: `#${data.value?.tag.name}` }));
</script>

<template>
  <section v-if="data" class="container">
    <p class="muted">Tag</p>
    <h1>#{{ data.tag.name }}</h1>
    <PostList :result="data.result" :base="`/tag/${data.tag.slug}`" />
  </section>
</template>
