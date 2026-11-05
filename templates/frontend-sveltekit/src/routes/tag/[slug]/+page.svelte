<script lang="ts">
  import PostList from "#lib/components/PostList.svelte";

  let { data } = $props();
</script>

<section class="container">
  <p class="muted">Tag</p>
  <h1>#{data.tag.name}</h1>
  <PostList result={data.result} base="/tag/{data.tag.slug}" />
</section>
