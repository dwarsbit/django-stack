<script lang="ts">
  import type { Paginated, Post } from "@django-stack/utils";
  import PostCard from "./PostCard.svelte";

  interface Props {
    result: Paginated<Post>;
    /** The URL of the list, without the page parameter. */
    base: string;
  }

  let { result, base }: Props = $props();
  const { current, pages } = $derived(result.pagination);
  const pageUrl = (page: number) => (page === 1 ? base : `${base}?page=${page}`);
</script>

{#if result.data.length === 0}
  <p class="muted">No posts yet.</p>
{/if}
<div class="grid">
  {#each result.data as post (post.id)}
    <PostCard {post} />
  {/each}
</div>
{#if pages > 1}
  <nav class="pagination" aria-label="Pages">
    {#if current > 1}<a href={pageUrl(current - 1)}>← Newer</a>{/if}
    <span class="muted">Page {current} of {pages}</span>
    {#if current < pages}<a href={pageUrl(current + 1)}>Older →</a>{/if}
  </nav>
{/if}

<style>
  .pagination {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
    margin: 3rem 0;
  }
</style>
