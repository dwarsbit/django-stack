<script lang="ts">
  import PostList from "#lib/components/PostList.svelte";

  let { data } = $props();
</script>

<section class="container">
  <h1>Blog</h1>
  <PostList result={data.result} base="/blog" />
</section>
