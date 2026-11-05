<script setup lang="ts">
import type { NuxtError } from "#app";

const props = defineProps<{ error: NuxtError }>();
const notFound = computed(() => props.error.statusCode === 404);
useHead({ title: notFound.value ? "Page not found" : "Something went wrong" });
</script>

<template>
  <NuxtLayout>
    <section class="narrow">
      <template v-if="notFound">
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist or has moved.</p>
      </template>
      <template v-else>
        <h1>Something went wrong</h1>
        <p>The page could not be shown. Try again in a moment.</p>
      </template>
      <p><a href="/">Go to the home page</a></p>
    </section>
  </NuxtLayout>
</template>
