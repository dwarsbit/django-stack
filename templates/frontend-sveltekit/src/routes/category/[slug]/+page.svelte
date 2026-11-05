<script lang="ts">
  import PostList from "#lib/components/PostList.svelte";

  let { data } = $props();
</script>

<section class="container">
  <p class="muted">Category</p>
  <h1>{data.category.name}</h1>
  {#if data.category.description}<p>{data.category.description}</p>{/if}
  <PostList result={data.result} base="/category/{data.category.slug}" />
</section>
