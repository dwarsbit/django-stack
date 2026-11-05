<script setup lang="ts">
const route = useRoute();
const { data } = await useContent(`/_content/category/${route.params.slug}`, () => ({ page: route.query.page }));
usePageSeo(() => ({ title: data.value?.category.name, seo_description: data.value?.category.description ?? "" }));
</script>

<template>
  <section v-if="data" class="container">
    <p class="muted">Category</p>
    <h1>{{ data.category.name }}</h1>
    <p v-if="data.category.description">{{ data.category.description }}</p>
    <PostList :result="data.result" :base="`/category/${data.category.slug}`" />
  </section>
</template>
